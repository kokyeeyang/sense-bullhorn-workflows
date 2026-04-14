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

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
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

function buildDailyEmailRecords({ records }) {
  const emailActions = new Set(["would-send-email", "sent-email"]);
  const dailyEmails = [];

  for (const record of records || []) {
    if (!emailActions.has(record.actionDecision)) {
      continue;
    }

    const details = record.details || {};
    dailyEmails.push({
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
      recipientEmail: normalizeString(details.recipientEmail || ""),
      ccEmails: Array.isArray(details.ccEmails) ? details.ccEmails.map((value) => normalizeString(value)) : [],
      stage: normalizeString(details.stage || ""),
      statusChange: details.statusChange || null,
    });
  }

  return dailyEmails;
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
    record.recipientEmail || "",
    stableStringify(record.ccEmails || []),
    record.stage || "",
    stableStringify(record.statusChange),
  ].join("|");

  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

let cachedClient = null;
let cachedKey = null;
let ensureTablePromise = null;

function getClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.AZURE_WORKFLOW_DAILY_EMAIL_TABLE_NAME;

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
    runTimestampDisplay: buildHumanReadableDateTime(record.generatedAt) || "",
    sourceSystem: record.sourceSystem || "azure-functions",
    recordType: record.recordType || "",
    actionDecision: record.actionDecision || "",
    entityType: record.entityType || "",
    entityId: record.entityId ?? null,
    transactionId: record.transactionId || "",
    candidateId: record.candidateId ?? null,
    relatedId: record.relatedId ?? null,
    recipientEmail: record.recipientEmail || "",
    ccEmailsJson: JSON.stringify(record.ccEmails || []),
    stage: record.stage || "",
    statusChangeJson: JSON.stringify(record.statusChange),
  };
}

function parseJsonValue(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function writeWorkflowDailyEmailRecords({ config, logger, records }) {
  const dailyEmails = buildDailyEmailRecords({ records });
  const client = getClient({ config });

  if (!client || dailyEmails.length === 0) {
    return { skipped: true, count: 0 };
  }

  await ensureTable({ client });

  for (const record of dailyEmails) {
    await client.upsertEntity(buildEntity({ config, record }), "Replace");
  }

  logger.info(
    {
      tableName: config.AZURE_WORKFLOW_DAILY_EMAIL_TABLE_NAME,
      recordCount: dailyEmails.length,
    },
    "Workflow daily email records written to Azure Table Storage",
  );

  return { skipped: false, count: dailyEmails.length };
}

async function listWorkflowDailyEmailRecordsForDate({ config, workflowName, runDate }) {
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
      recipientEmail: entity.recipientEmail || null,
      ccEmails: parseJsonValue(entity.ccEmailsJson, []),
      stage: entity.stage || null,
      statusChange: parseJsonValue(entity.statusChangeJson, null),
    });
  }

  return entities.sort((left, right) =>
    String(left.runTimestamp || "").localeCompare(String(right.runTimestamp || "")),
  );
}

async function writeWorkflowDailyEmailRecordsSafe(args) {
  try {
    return await writeWorkflowDailyEmailRecords(args);
  } catch (error) {
    args.logger.warn(
      {
        tableName: args.config.AZURE_WORKFLOW_DAILY_EMAIL_TABLE_NAME,
        message: error.message,
      },
      "Skipping workflow daily email table write because it failed",
    );

    return {
      skipped: true,
      count: 0,
      error: error.message,
    };
  }
}

module.exports = {
  buildDailyEmailRecords,
  listWorkflowDailyEmailRecordsForDate,
  writeWorkflowDailyEmailRecords,
  writeWorkflowDailyEmailRecordsSafe,
};
