const { TableClient } = require("@azure/data-tables");

const { getEnvironmentLabel } = require("./workflowRunLogStore");

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

function buildPartitionKey({ environment, workflowName }) {
  return `${environment}|${workflowName}`;
}

function buildRowKey({ entityType, entityId }) {
  return `${entityType || "unknown-entity"}|${entityId ?? "no-entity-id"}`;
}

let cachedClient = null;
let cachedKey = null;
let ensureTablePromise = null;

function getClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.AZURE_WORKFLOW_SEND_LOCK_TABLE_NAME;

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

async function reserveWorkflowSend({ config, workflowName, entityType, entityId, metadata = {} }) {
  const client = getClient({ config });
  if (!client) {
    return { skipped: true, reserved: true, reason: "missing-table-config" };
  }

  await ensureTable({ client });

  const environment = getEnvironmentLabel(config);
  const partitionKey = buildPartitionKey({ environment, workflowName });
  const rowKey = buildRowKey({ entityType, entityId });

  try {
    await client.createEntity({
      partitionKey,
      rowKey,
      environment,
      workflowName,
      entityType,
      entityId: entityId ?? null,
      reservedAt: new Date().toISOString(),
      metadataJson: JSON.stringify(metadata),
    });
  } catch (error) {
    if (error.statusCode === 409) {
      return { skipped: false, reserved: false, reason: "already-reserved" };
    }
    throw error;
  }

  return { skipped: false, reserved: true, reason: "reserved" };
}

async function releaseWorkflowSend({ config, workflowName, entityType, entityId }) {
  const client = getClient({ config });
  if (!client) {
    return { skipped: true };
  }

  await ensureTable({ client });

  await client.deleteEntity(
    buildPartitionKey({ environment: getEnvironmentLabel(config), workflowName }),
    buildRowKey({ entityType, entityId }),
  );

  return { skipped: false };
}

module.exports = {
  buildPartitionKey,
  buildRowKey,
  releaseWorkflowSend,
  reserveWorkflowSend,
};
