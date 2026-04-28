const crypto = require("node:crypto");

const { TableClient } = require("@azure/data-tables");

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function buildRowKey(response) {
  const fingerprint = [
    response.placementId ?? "",
    response.candidateId ?? "",
    response.questionId || "",
  ].join("|");
  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

let cachedClient = null;
let cachedKey = null;
let ensureTablePromise = null;

function getClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.HARASSMENT_TRAINING_RESPONSE_TABLE_NAME;

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
  return {
    partitionKey: String(response.placementId ?? "unknown"),
    rowKey: buildRowKey(response),
    submittedAt,
    placementId: response.placementId ?? null,
    candidateId: response.candidateId ?? null,
    candidateEmail: normalizeString(response.candidateEmail),
    state: normalizeString(response.state),
    questionId: normalizeString(response.questionId),
    answer: normalizeString(response.answer).toLowerCase(),
    issuedAt: response.issuedAt || "",
    userAgent: normalizeString(response.userAgent),
    remoteAddress: normalizeString(response.remoteAddress),
  };
}

async function saveHarassmentTrainingResponse({ config, response }) {
  const client = getClient({ config });
  if (!client) {
    return {
      skipped: true,
      reason: "missing-azure-table-storage-connection-string",
    };
  }

  await ensureTable({ client });
  const entity = buildEntity(response);
  await client.upsertEntity(entity, "Merge");

  return {
    skipped: false,
    partitionKey: entity.partitionKey,
    rowKey: entity.rowKey,
  };
}

module.exports = {
  buildEntity,
  saveHarassmentTrainingResponse,
};
