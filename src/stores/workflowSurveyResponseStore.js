const crypto = require("node:crypto");

const { TableClient } = require("@azure/data-tables");
const { saveWorkflowSurveyResponsePostgres } = require("./postgresWorkflowSurveyStore");

const { normalizeString } = require("../utils/workflowSurveyUtils");
const { extractSurveyGeoFields } = require("../utils/surveyGeoUtils");

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

function buildRowKey(response) {
  if (normalizeString(response?.surveyKey)) {
    return normalizeString(response.surveyKey);
  }

  const fingerprint = [
    response.workflowName || "",
    response.placementId ?? "",
    response.questionId || "",
    response.ownerId ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

let cachedClient = null;
let cachedKey = null;
let ensureTablePromise = null;

function getClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.WORKFLOW_SURVEY_RESPONSE_TABLE_NAME;

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

function buildEntity(response) {
  const submittedAt = response.submittedAt || new Date().toISOString();
  const geo = extractSurveyGeoFields(response);
  return {
    partitionKey: String(response.workflowName || "unknown-workflow"),
    rowKey: buildRowKey(response),
    submittedAt,
    workflowName: normalizeString(response.workflowName),
    placementId: response.placementId ?? null,
    candidateId: response.candidateId ?? null,
    ownerId: response.ownerId ?? null,
    ownerEmail: normalizeString(response.ownerEmail).toLowerCase(),
    recipientEmail: normalizeString(response.recipientEmail || response.ownerEmail).toLowerCase(),
    questionId: normalizeString(response.questionId),
    questionText: normalizeString(response.questionText),
    answer: normalizeString(response.answer).toLowerCase(),
    issuedAt: response.issuedAt || "",
    surveyKey: normalizeString(response.surveyKey),
    candidateRegion: geo.candidateRegion,
    candidateCountry: geo.candidateCountry,
    assignmentRegion: geo.assignmentRegion,
    assignmentCountry: geo.assignmentCountry,
    metadataJson: JSON.stringify(response.metadata || {}),
    userAgent: normalizeString(response.userAgent),
    remoteAddress: normalizeString(response.remoteAddress),
  };
}

async function saveWorkflowSurveyResponse({ config, response }) {
  const entity = buildEntity(response);
  const client = getClient({ config });
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
    results.push({
      target: "azure-table",
      skipped: true,
      reason: "missing-azure-table-storage-connection-string",
    });
  }

  if (config.POSTGRES_CONNECTION_STRING) {
    try {
      const postgresResult = await saveWorkflowSurveyResponsePostgres({
        config,
        response,
        entity,
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

module.exports = {
  buildEntity,
  saveWorkflowSurveyResponse,
};
