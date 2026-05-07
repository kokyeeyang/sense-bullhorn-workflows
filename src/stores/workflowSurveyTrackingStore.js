const { TableClient } = require("@azure/data-tables");

const { normalizeString } = require("../utils/workflowSurveyUtils");
const { getEnvironmentLabel } = require("./workflowRunLogStore");
const { upsertWorkflowSurveyTrackingPostgres } = require("./postgresWorkflowSurveyStore");

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

function buildMonthKey(value) {
  return String(value).slice(0, 7);
}

function buildTrackingPartitionKey({ workflowName, reminderDueDate }) {
  return `${workflowName}|${buildMonthKey(reminderDueDate)}`;
}

function buildTrackingRowKey({ reminderDueDate, surveyKey }) {
  return `${reminderDueDate}|${surveyKey}`;
}

let cachedClient = null;
let cachedKey = null;
let ensureTablePromise = null;

function getClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.WORKFLOW_SURVEY_TRACKING_TABLE_NAME;

  if (!connectionString || !tableName) {
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

function buildTrackingEntity({ config, tracking }) {
  const environment = getEnvironmentLabel(config);

  return {
    partitionKey: tracking.partitionKey,
    rowKey: tracking.rowKey,
    environment,
    workflowName: normalizeString(tracking.workflowName),
    surveyKey: normalizeString(tracking.surveyKey),
    ruleKey: normalizeString(tracking.ruleKey),
    sendType: normalizeString(tracking.sendType || "initial"),
    recipientType: normalizeString(tracking.recipientType),
    recipientEmail: normalizeString(tracking.recipientEmail).toLowerCase(),
    recipientFirstName: normalizeString(tracking.recipientFirstName),
    candidateId: tracking.candidateId ?? null,
    candidateName: normalizeString(tracking.candidateName),
    clientContactId: tracking.clientContactId ?? null,
    clientContactName: normalizeString(tracking.clientContactName),
    placementId: tracking.placementId ?? null,
    clientCorporationId: tracking.clientCorporationId ?? null,
    clientCorporationName: normalizeString(tracking.clientCorporationName),
    employmentType: normalizeString(tracking.employmentType),
    currentPlacementStatus: normalizeString(tracking.currentPlacementStatus),
    businessDate: normalizeString(tracking.businessDate),
    initialSentAt: normalizeString(tracking.initialSentAt),
    initialSentDate: normalizeString(tracking.initialSentDate),
    reminderDueDate: normalizeString(tracking.reminderDueDate),
    reminderSentAt: normalizeString(tracking.reminderSentAt),
    respondedAt: normalizeString(tracking.respondedAt),
    responseAnswer: normalizeString(tracking.responseAnswer),
    trackingStatus: normalizeString(tracking.trackingStatus || "pending"),
    tokenIssuedAt: normalizeString(tracking.tokenIssuedAt),
    contextJson: JSON.stringify(tracking.context || {}),
    metadataJson: JSON.stringify(tracking.metadata || {}),
    runDate: normalizeString(tracking.runDate || tracking.businessDate || tracking.initialSentDate),
    updatedAt: new Date().toISOString(),
  };
}

async function upsertWorkflowSurveyTracking({ config, tracking }) {
  const client = getClient({ config });
  const entity = buildTrackingEntity({ config, tracking });
  const results = [];
  const errors = [];

  if (client) {
    try {
      await ensureTable({ client });
      await client.upsertEntity(entity, "Merge");
      results.push({
        target: "azure-table",
        skipped: false,
        partitionKey: entity.partitionKey,
        rowKey: entity.rowKey,
      });
    } catch (error) {
      errors.push(error);
      results.push({
        target: "azure-table",
        skipped: true,
        reason: "write-failed",
        error: error.message,
      });
    }
  } else {
    results.push({ target: "azure-table", skipped: true, reason: "missing-table-config" });
  }

  if (config.POSTGRES_CONNECTION_STRING) {
    try {
      const postgresResult = await upsertWorkflowSurveyTrackingPostgres({
        config,
        tracking: {
          ...tracking,
          environment: entity.environment,
        },
      });
      results.push({ target: "postgres", ...postgresResult });
    } catch (error) {
      errors.push(error);
      results.push({
        target: "postgres",
        skipped: true,
        reason: "write-failed",
        error: error.message,
      });
    }
  }

  if (results.every((result) => result.skipped) && errors.length > 0) {
    throw errors[0];
  }

  return {
    skipped: results.every((result) => result.skipped),
    partitionKey: entity.partitionKey,
    rowKey: entity.rowKey,
    results,
  };
}

async function getWorkflowSurveyTracking({ config, partitionKey, rowKey }) {
  const client = getClient({ config });
  if (!client) {
    return null;
  }

  await ensureTable({ client });

  try {
    return await client.getEntity(partitionKey, rowKey);
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function listWorkflowSurveyTrackingDueForReminder({ config, workflowName, dueDate }) {
  const client = getClient({ config });
  if (!client) {
    return [];
  }

  await ensureTable({ client });
  const partitionKey = buildTrackingPartitionKey({ workflowName, reminderDueDate: dueDate });
  const startRowKey = `${dueDate}|`;
  const endRowKey = `${dueDate}|~`;
  const entities = [];

  for await (const entity of client.listEntities({
    queryOptions: {
      filter:
        `PartitionKey eq '${partitionKey.replace(/'/g, "''")}' and ` +
        `RowKey ge '${startRowKey.replace(/'/g, "''")}' and ` +
        `RowKey lt '${endRowKey.replace(/'/g, "''")}'`,
    },
  })) {
    if (normalizeString(entity.respondedAt) || normalizeString(entity.reminderSentAt)) {
      continue;
    }
    entities.push(entity);
  }

  return entities;
}

module.exports = {
  buildMonthKey,
  buildTrackingPartitionKey,
  buildTrackingRowKey,
  getWorkflowSurveyTracking,
  listWorkflowSurveyTrackingDueForReminder,
  upsertWorkflowSurveyTracking,
};
