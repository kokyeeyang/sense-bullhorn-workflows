require("dotenv").config();

const { TableClient } = require("@azure/data-tables");

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { serializeError } = require("../utils/workflowRuntime");

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

function buildClient({ config, tableName }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    return null;
  }

  if (!isLikelyConnectionString(connectionString)) {
    throw new Error(
      "AZURE_TABLE_STORAGE_CONNECTION_STRING must be a full Azure Storage connection string",
    );
  }

  return TableClient.fromConnectionString(connectionString, tableName);
}

function buildCutoffDate({ retentionDays }) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff.toISOString().slice(0, 10);
}

function buildReservedAtCutoff({ retentionDays }) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return cutoff.toISOString();
}

async function listEntities({ client, filter }) {
  const entities = [];

  for await (const entity of client.listEntities({
    queryOptions: { filter },
  })) {
    entities.push(entity);
  }

  return entities;
}

async function deleteEntities({ client, entities }) {
  let deletedCount = 0;

  for (const entity of entities) {
    await client.deleteEntity(entity.partitionKey, entity.rowKey);
    deletedCount += 1;
  }

  return deletedCount;
}

async function cleanupTable({ client, fieldName, cutoffValue, dryRun }) {
  const entities = await listEntities({
    client,
    filter: `${fieldName} lt '${String(cutoffValue).replace(/'/g, "''")}'`,
  });

  if (dryRun || entities.length === 0) {
    return {
      matchedCount: entities.length,
      deletedCount: 0,
    };
  }

  const deletedCount = await deleteEntities({ client, entities });
  return {
    matchedCount: entities.length,
    deletedCount,
  };
}

async function run() {
  const config = loadConfig();
  const retentionDays = Number(config.AZURE_WORKFLOW_RETENTION_DAYS || 60);
  const dryRun = Boolean(config.DRY_RUN);
  const cutoffDate = buildCutoffDate({ retentionDays });
  const reservedAtCutoff = buildReservedAtCutoff({ retentionDays });

  const tableTargets = [
    {
      tableName: config.AZURE_TABLE_STORAGE_TABLE_NAME,
      fieldName: "runDate",
    },
    {
      tableName: config.AZURE_WORKFLOW_DASHBOARD_BY_DAY_TABLE_NAME,
      fieldName: "runDate",
    },
    {
      tableName: config.AZURE_WORKFLOW_DASHBOARD_BY_WORKFLOW_TABLE_NAME,
      fieldName: "runDate",
    },
    {
      tableName: config.AZURE_WORKFLOW_SEND_LOCK_TABLE_NAME,
      fieldName: "reservedAt",
      cutoffValue: reservedAtCutoff,
    },
    {
      tableName: config.WORKFLOW_SURVEY_TRACKING_TABLE_NAME,
      fieldName: "initialSentDate",
    },
    {
      tableName: config.WORKFLOW_SURVEY_RESPONSE_TABLE_NAME,
      fieldName: "submittedAt",
      cutoffValue: reservedAtCutoff,
    },
  ];

  const tables = [];

  for (const target of tableTargets) {
    const client = buildClient({ config, tableName: target.tableName });
    if (!client) {
      tables.push({
        tableName: target.tableName,
        skipped: true,
        reason: "table-storage-not-configured",
      });
      continue;
    }

    const result = await cleanupTable({
      client,
      fieldName: target.fieldName,
      cutoffValue: target.cutoffValue || cutoffDate,
      dryRun,
    });

    tables.push({
      tableName: target.tableName,
      fieldName: target.fieldName,
      cutoffValue: target.cutoffValue || cutoffDate,
      ...result,
    });
  }

  const totals = tables.reduce(
    (aggregate, table) => {
      aggregate.matchedCount += Number(table.matchedCount || 0);
      aggregate.deletedCount += Number(table.deletedCount || 0);
      return aggregate;
    },
    { matchedCount: 0, deletedCount: 0 },
  );

  const result = {
    generatedAt: new Date().toISOString(),
    dryRun,
    retentionDays,
    cutoffDate,
    tables,
    totals,
  };

  logger.info(result, "Workflow dashboard retention cleanup finished");
  return result;
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Workflow dashboard retention cleanup failed");
    process.exitCode = 1;
  });
}

module.exports = {
  buildCutoffDate,
  buildReservedAtCutoff,
  run,
};
