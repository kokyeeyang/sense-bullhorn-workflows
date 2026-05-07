const crypto = require("node:crypto");

const { TableClient } = require("@azure/data-tables");
const { writeWorkflowComparisonRecordsPostgres } = require("./postgresWorkflowComparisonStore");

const {
  buildRunDate,
  getEnvironmentLabel,
} = require("./workflowRunLogStore");

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

function buildPartitionKey({ environment, runDate }) {
  return `${environment}|${runDate}`;
}

function buildRowKey(record) {
  return [
    record.placementId || "no-placement",
    record.transactionId || "no-transaction",
    record.actionDecision || "unknown-action",
    crypto.randomUUID(),
  ].join("|");
}

let cachedClient = null;
let cachedKey = null;
let ensureTablePromise = null;

function getClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.AZURE_PLACEMENT_DATABASE_ENRICHMENT_COMPARISON_TABLE_NAME;

  if (!connectionString) {
    return null;
  }

  if (!isLikelyConnectionString(connectionString)) {
    throw new Error(
      "AZURE_TABLE_STORAGE_CONNECTION_STRING must be a full Azure Storage connection string",
    );
  }

  const cacheKey = `${tableName}|${connectionString}`;
  if (cachedClient && cachedKey === cacheKey) {
    return cachedClient;
  }

  cachedClient = TableClient.fromConnectionString(connectionString, tableName);
  cachedKey = cacheKey;
  ensureTablePromise = null;

  return cachedClient;
}

async function ensureTable({ client }) {
  if (!ensureTablePromise) {
    ensureTablePromise = client.createTable().catch((error) => {
      if (error.statusCode === 409) {
        return;
      }
      throw error;
    });
  }

  await ensureTablePromise;
}

function buildEntity({ config, record }) {
  const environment = getEnvironmentLabel(config);
  const runDate = buildRunDate(record.generatedAt);

  return {
    partitionKey: buildPartitionKey({ environment, runDate }),
    rowKey: buildRowKey(record),
    environment,
    workflowName: record.workflowName || "placement-database-enrichment-sync",
    runDate,
    runTimestamp: record.generatedAt || null,
    sourceSystem: record.sourceSystem || "azure-functions",
    recordType: record.recordType || null,
    actionDecision: record.actionDecision || null,
    placementId: record.placementId ?? null,
    transactionId: record.transactionId || "",
    candidateId: record.candidateId ?? null,
    employmentType: record.employmentType || "",
    currentPlacementStatus: record.currentPlacementStatus || "",
    statusOldValue: record.statusOldValue == null ? "" : String(record.statusOldValue),
    statusNewValue: record.statusNewValue == null ? "" : String(record.statusNewValue),
    dateLastModified: record.dateLastModified || "",
    matchReason: record.matchReason || "",
    ruleType: record.ruleType || "",
    fieldsToChangeJson: JSON.stringify(record.fieldsToChange || []),
    updatedPropertiesJson: JSON.stringify(record.updatedProperties || []),
  };
}

async function writeComparisonRecords({ config, logger, records }) {
  const client = getClient({ config });
  if (!client || !Array.isArray(records) || records.length === 0) {
    return { skipped: true, count: 0 };
  }

  await ensureTable({ client });

  for (const record of records) {
    await client.createEntity(buildEntity({ config, record }));
  }

  logger.info(
    {
      tableName: config.AZURE_PLACEMENT_DATABASE_ENRICHMENT_COMPARISON_TABLE_NAME,
      recordCount: records.length,
    },
    "Placement database enrichment comparison records written to Azure Table Storage",
  );

  return { skipped: false, count: records.length };
}

async function writeComparisonRecordsSafe(args) {
  const results = [];
  const errors = [];

  try {
    const azureResult = await writeComparisonRecords(args);
    results.push({ target: "azure-table", ...azureResult });
  } catch (error) {
    errors.push(error);
    results.push({
      target: "azure-table",
      skipped: true,
      count: 0,
      reason: "table-storage-write-failed",
      error: error.message,
    });
  }

  if (args.config.POSTGRES_CONNECTION_STRING) {
    try {
      const postgresResult = await writeWorkflowComparisonRecordsPostgres({
        config: args.config,
        logger: args.logger,
        records: args.records,
      });
      results.push({ target: "postgres", ...postgresResult });
    } catch (error) {
      errors.push(error);
      results.push({
        target: "postgres",
        skipped: true,
        count: 0,
        reason: "postgres-write-failed",
        error: error.message,
      });
    }
  }

  if (results.some((result) => !result.skipped)) {
    return {
      skipped: false,
      count: results.reduce((sum, result) => sum + Number(result.count || 0), 0),
      results,
    };
  }

  if (errors.length > 0) {
    args.logger.warn(
      {
        message: errors[0].message,
        tableName: args.config.AZURE_PLACEMENT_DATABASE_ENRICHMENT_COMPARISON_TABLE_NAME,
      },
      "Skipping placement database enrichment comparison writes because all reporting writes failed",
    );
  }

  return {
    skipped: true,
    count: 0,
    results,
  };
}

module.exports = {
  writeComparisonRecords,
  writeComparisonRecordsSafe,
};
