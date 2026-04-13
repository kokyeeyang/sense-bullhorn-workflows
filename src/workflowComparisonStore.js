const crypto = require("node:crypto");

const { TableClient } = require("@azure/data-tables");

const { buildRunDate, getEnvironmentLabel } = require("./workflowRunLogStore");

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

function buildPartitionKey({ environment, workflowName, runDate }) {
  return `${environment}|${workflowName}|${runDate}`;
}

function buildRowKey(record) {
  return [
    record.entityType || "unknown-entity",
    record.entityId ?? "no-entity-id",
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
  const tableName = config.AZURE_WORKFLOW_COMPARISON_TABLE_NAME;

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
    partitionKey: buildPartitionKey({
      environment,
      workflowName: record.workflowName,
      runDate,
    }),
    rowKey: buildRowKey(record),
    environment,
    workflowName: record.workflowName,
    runDate,
    runTimestamp: record.generatedAt || null,
    sourceSystem: record.sourceSystem || "azure-functions",
    recordType: record.recordType || "",
    actionDecision: record.actionDecision || "",
    entityType: record.entityType || "",
    entityId: record.entityId ?? null,
    transactionId: record.transactionId || "",
    candidateId: record.candidateId ?? null,
    relatedId: record.relatedId ?? null,
    detailsJson: JSON.stringify(record.details || {}),
  };
}

async function writeWorkflowComparisonRecords({ config, logger, records }) {
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
      tableName: config.AZURE_WORKFLOW_COMPARISON_TABLE_NAME,
      recordCount: records.length,
    },
    "Workflow comparison records written to Azure Table Storage",
  );

  return { skipped: false, count: records.length };
}

async function writeWorkflowComparisonRecordsSafe(args) {
  try {
    return await writeWorkflowComparisonRecords(args);
  } catch (error) {
    args.logger.warn(
      {
        message: error.message,
        tableName: args.config.AZURE_WORKFLOW_COMPARISON_TABLE_NAME,
      },
      "Skipping workflow comparison table write because it failed",
    );

    return {
      skipped: true,
      count: 0,
      error: error.message,
    };
  }
}

module.exports = {
  writeWorkflowComparisonRecords,
  writeWorkflowComparisonRecordsSafe,
};
