require("dotenv").config();

const { TableClient } = require("@azure/data-tables");

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { buildPartitionKey, getEnvironmentLabel } = require("./workflowRunLogStore");
const { DAILY_COMPARISON_WORKFLOWS, resolveSummaryDates } = require("./dailyWorkflowComparisonSummary");
const { serializeError } = require("./workflowRuntime");

function isLikelyConnectionString(value) {
  return (
    typeof value === "string" &&
    value.includes("DefaultEndpointsProtocol=") &&
    value.includes("AccountName=")
  );
}

function parseArgs(argv) {
  const args = {};

  for (const rawArg of argv) {
    if (!rawArg.startsWith("--")) {
      continue;
    }

    const separatorIndex = rawArg.indexOf("=");
    if (separatorIndex < 0) {
      args[rawArg.slice(2)] = "true";
      continue;
    }

    args[rawArg.slice(2, separatorIndex)] = rawArg.slice(separatorIndex + 1);
  }

  return args;
}

function resolveWorkflowNames(workflowName) {
  if (!workflowName || workflowName === "all") {
    return DAILY_COMPARISON_WORKFLOWS;
  }

  const workflowNames = String(workflowName)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const unsupported = workflowNames.filter((value) => !DAILY_COMPARISON_WORKFLOWS.includes(value));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported workflowName value(s): ${unsupported.join(", ")}`);
  }

  return workflowNames;
}

function escapeODataString(value) {
  return String(value).replace(/'/g, "''");
}

function buildFilter({ partitionKey, actionDecision }) {
  const filters = [`PartitionKey eq '${escapeODataString(partitionKey)}'`];

  if (actionDecision) {
    filters.push(`actionDecision eq '${escapeODataString(actionDecision)}'`);
  }

  return filters.join(" and ");
}

function buildClient({ config }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;
  const tableName = config.AZURE_WORKFLOW_DAILY_CHANGE_TABLE_NAME;

  if (!connectionString) {
    throw new Error("AZURE_TABLE_STORAGE_CONNECTION_STRING is required");
  }

  if (!isLikelyConnectionString(connectionString)) {
    throw new Error(
      "AZURE_TABLE_STORAGE_CONNECTION_STRING must be a full Azure Storage connection string",
    );
  }

  return TableClient.fromConnectionString(connectionString, tableName);
}

async function listEntitiesForPartition({ client, partitionKey, actionDecision }) {
  const entities = [];

  for await (const entity of client.listEntities({
    queryOptions: {
      filter: buildFilter({ partitionKey, actionDecision }),
    },
  })) {
    entities.push(entity);
  }

  return entities;
}

async function deleteEntities({ client, entities }) {
  let deleted = 0;

  for (const entity of entities) {
    await client.deleteEntity(entity.partitionKey, entity.rowKey);
    deleted += 1;
  }

  return deleted;
}

async function run(options = {}) {
  const config = loadConfig();
  const args = {
    ...parseArgs(process.argv.slice(2)),
    ...options,
  };
  const environment = getEnvironmentLabel(config);
  const workflowNames = resolveWorkflowNames(
    args.workflowName || process.env.CLEANUP_WORKFLOW_NAME,
  );
  const summaryDates = resolveSummaryDates({
    targetDate: args.targetDate || process.env.CLEANUP_TARGET_DATE,
    dateFrom: args.dateFrom || process.env.CLEANUP_DATE_FROM,
    dateTo: args.dateTo || process.env.CLEANUP_DATE_TO,
  });
  const actionDecision = args.actionDecision || process.env.CLEANUP_ACTION_DECISION || null;
  const dryRun = config.DRY_RUN !== false;
  const confirmDelete =
    String(args.confirm || process.env.CONFIRM_DELETE || "")
      .trim()
      .toLowerCase() === "true";

  if (!dryRun && !confirmDelete) {
    throw new Error("Refusing to delete without CONFIRM_DELETE=true or --confirm=true");
  }

  const client = buildClient({ config });
  const targets = [];

  for (const runDate of summaryDates) {
    for (const workflowName of workflowNames) {
      const partitionKey = buildPartitionKey({ environment, workflowName, runDate });
      const entities = await listEntitiesForPartition({ client, partitionKey, actionDecision });
      targets.push({
        runDate,
        workflowName,
        partitionKey,
        entityCount: entities.length,
        entities,
      });
    }
  }

  let deletedCount = 0;
  if (!dryRun) {
    for (const target of targets) {
      deletedCount += await deleteEntities({ client, entities: target.entities });
    }
  }

  const result = {
    tableName: config.AZURE_WORKFLOW_DAILY_CHANGE_TABLE_NAME,
    environment,
    dryRun,
    actionDecision,
    targets: targets.map(({ runDate, workflowName, partitionKey, entityCount }) => ({
      runDate,
      workflowName,
      partitionKey,
      entityCount,
    })),
    matchedCount: targets.reduce((sum, target) => sum + target.entityCount, 0),
    deletedCount,
  };

  logger.info(result, "Workflow daily change cleanup finished");
  return result;
}

if (require.main === module) {
  run()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      logger.error(serializeError(error), "Workflow daily change cleanup failed");
      process.exitCode = 1;
    });
}

module.exports = {
  run,
};
