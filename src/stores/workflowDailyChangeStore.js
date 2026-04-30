const crypto = require("node:crypto");

const { TableClient } = require("@azure/data-tables");

const { buildHumanReadableDateTime, buildRunDate, getEnvironmentLabel } = require("./workflowRunLogStore");

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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function normalizeChangeValue(value) {
  if (value === undefined) {
    return null;
  }

  return value;
}

function buildDailyChangeRecords({ records }) {
  const dailyChanges = [];

  for (const record of records || []) {
    const details = record.details || {};
    const changes = Array.isArray(details.changes) ? details.changes : [];

    for (const change of changes) {
      if (!change || typeof change !== "object" || !("field" in change)) {
        continue;
      }

      dailyChanges.push({
        generatedAt: record.generatedAt,
        sourceSystem: record.sourceSystem || "azure-functions",
        workflowName: record.workflowName,
        recordType: record.recordType || "",
        actionDecision: record.actionDecision || "",
        entityType: record.entityType || "",
        entityId: record.entityId ?? null,
        transactionId: record.transactionId || "",
        candidateId: record.candidateId ?? null,
        relatedId: record.relatedId ?? null,
        matchReason: details.matchReason || null,
        ruleType: details.ruleType || null,
        mappingType: details.mappingType || null,
        field: String(change.field),
        oldValue: normalizeChangeValue(change.oldValue),
        newValue: normalizeChangeValue(change.newValue),
      });
    }
  }

  return dailyChanges;
}

function buildRowKey(record) {
  const fingerprint = [
    record.workflowName || "",
    record.recordType || "",
    record.actionDecision || "",
    record.entityType || "",
    record.entityId ?? "",
    record.transactionId || "",
    record.candidateId ?? "",
    record.relatedId ?? "",
    record.matchReason || "",
    record.ruleType || "",
    record.mappingType || "",
    record.field || "",
    stableStringify(record.oldValue),
    stableStringify(record.newValue),
  ].join("|");

  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

let cachedClient = null;
let cachedKey = null;
let ensureTablePromise = null;

function getClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.AZURE_WORKFLOW_DAILY_CHANGE_TABLE_NAME;

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
  const rowKey = buildRowKey(record);

  return {
    partitionKey: buildPartitionKey({
      environment,
      workflowName: record.workflowName,
      runDate,
    }),
    rowKey,
    environment,
    workflowName: record.workflowName,
    runDate,
    runTimestamp: record.generatedAt || null,
    runTimestampDisplay: buildHumanReadableDateTime(record.generatedAt) || "",
    sourceSystem: record.sourceSystem || "azure-functions",
    recordType: record.recordType || "",
    actionDecision: record.actionDecision || "",
    entityType: record.entityType || "",
    entityId: record.entityId ?? null,
    transactionId: record.transactionId || "",
    candidateId: record.candidateId ?? null,
    relatedId: record.relatedId ?? null,
    matchReason: record.matchReason || "",
    ruleType: record.ruleType || "",
    mappingType: record.mappingType || "",
    field: record.field || "",
    oldValueJson: JSON.stringify(record.oldValue),
    newValueJson: JSON.stringify(record.newValue),
  };
}

function parseJsonValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function writeWorkflowDailyChangeRecords({ config, logger, records }) {
  const dailyChanges = buildDailyChangeRecords({ records });
  const client = getClient({ config });

  if (!client || dailyChanges.length === 0) {
    return { skipped: true, count: 0 };
  }

  await ensureTable({ client });

  for (const record of dailyChanges) {
    await client.upsertEntity(buildEntity({ config, record }), "Replace");
  }

  logger.info(
    {
      tableName: config.AZURE_WORKFLOW_DAILY_CHANGE_TABLE_NAME,
      recordCount: dailyChanges.length,
    },
    "Workflow daily change records written to Azure Table Storage",
  );

  return { skipped: false, count: dailyChanges.length };
}

async function listWorkflowDailyChangeRecordsForDate({ config, workflowName, runDate }) {
  const client = getClient({ config });
  if (!client) {
    return [];
  }

  await ensureTable({ client });
  const partitionKey = buildPartitionKey({
    environment: getEnvironmentLabel(config),
    workflowName,
    runDate,
  });
  const entities = [];

  for await (const entity of client.listEntities({
    queryOptions: {
      filter: `PartitionKey eq '${partitionKey.replace(/'/g, "''")}'`,
    },
  })) {
    entities.push({
      environment: entity.environment || null,
      workflowName: entity.workflowName || workflowName,
      runDate: entity.runDate || runDate,
      runTimestamp: entity.runTimestamp || null,
      runTimestampDisplay: entity.runTimestampDisplay || null,
      sourceSystem: entity.sourceSystem || "azure-functions",
      recordType: entity.recordType || null,
      actionDecision: entity.actionDecision || null,
      entityType: entity.entityType || null,
      entityId: entity.entityId ?? null,
      transactionId: entity.transactionId || null,
      candidateId: entity.candidateId ?? null,
      relatedId: entity.relatedId ?? null,
      matchReason: entity.matchReason || null,
      ruleType: entity.ruleType || null,
      mappingType: entity.mappingType || null,
      field: entity.field || null,
      oldValue: parseJsonValue(entity.oldValueJson),
      newValue: parseJsonValue(entity.newValueJson),
    });
  }

  return entities.sort((left, right) =>
    String(left.runTimestamp || "").localeCompare(String(right.runTimestamp || "")),
  );
}

async function writeWorkflowDailyChangeRecordsSafe(args) {
  try {
    return await writeWorkflowDailyChangeRecords(args);
  } catch (error) {
    args.logger.warn(
      {
        tableName: args.config.AZURE_WORKFLOW_DAILY_CHANGE_TABLE_NAME,
        message: error.message,
      },
      "Skipping workflow daily change table write because it failed",
    );

    return {
      skipped: true,
      count: 0,
      error: error.message,
    };
  }
}

module.exports = {
  buildDailyChangeRecords,
  listWorkflowDailyChangeRecordsForDate,
  writeWorkflowDailyChangeRecords,
  writeWorkflowDailyChangeRecordsSafe,
};
