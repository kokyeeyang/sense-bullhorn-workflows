const crypto = require("node:crypto");

const { TableClient } = require("@azure/data-tables");

function getEnvironmentLabel(config) {
  return String(config.BULLHORN_ENV || "production").trim().toLowerCase();
}

function buildRunDate(value) {
  return String(value).slice(0, 10);
}

function buildHumanReadableDateTime(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

function buildPartitionKey({ environment, workflowName, runDate }) {
  return `${environment}|${workflowName}|${runDate}`;
}

function buildRowKey({ finishedAt }) {
  return `${finishedAt}|${crypto.randomUUID()}`;
}

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

let cachedClient = null;
let cachedKey = null;
let ensureTablePromise = null;

function getClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.AZURE_TABLE_STORAGE_TABLE_NAME;

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

async function writeWorkflowRunLog({
  config,
  logger,
  workflowName,
  trigger,
  startedAt,
  finishedAt,
  status,
  summary,
}) {
  const client = getClient({ config });
  if (!client) {
    return { skipped: true, reason: "table-storage-not-configured" };
  }

  const environment = getEnvironmentLabel(config);
  const runDate = buildRunDate(finishedAt);
  const entity = {
    partitionKey: buildPartitionKey({ environment, workflowName, runDate }),
    rowKey: buildRowKey({ finishedAt }),
    environment,
    workflowName,
    runDate,
    trigger,
    status,
    startedAt,
    finishedAt,
    startedAtDisplay: buildHumanReadableDateTime(startedAt) || "",
    finishedAtDisplay: buildHumanReadableDateTime(finishedAt) || "",
    successCount: summary.successCount,
    failureCount: summary.failureCount,
    skippedCount: summary.skippedCount,
    summary: summary.summary,
    detailsJson: JSON.stringify(summary.details || {}),
    artifactPath: summary.artifactPath || "",
    emailedInDailySummary: false,
  };

  await ensureTable({ client });
  await client.createEntity(entity);

  logger.info(
    {
      environment,
      workflowName,
      runDate,
      status,
      partitionKey: entity.partitionKey,
    },
    "Workflow run log written to Azure Table Storage",
  );

  return { skipped: false, entity };
}

async function listWorkflowRunLogsForDate({ config, workflowName, runDate }) {
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
    entities.push(entity);
  }

  return entities;
}

async function writeWorkflowRunLogSafe(args) {
  try {
    return await writeWorkflowRunLog(args);
  } catch (error) {
    args.logger.warn(
      {
        workflowName: args.workflowName,
        status: args.status,
        message: error.message,
      },
      "Skipping workflow run log because Azure Table Storage write failed",
    );

    return {
      skipped: true,
      reason: "table-storage-write-failed",
      error: error.message,
    };
  }
}

module.exports = {
  buildPartitionKey,
  buildHumanReadableDateTime,
  buildRunDate,
  getEnvironmentLabel,
  listWorkflowRunLogsForDate,
  writeWorkflowRunLog,
  writeWorkflowRunLogSafe,
};
