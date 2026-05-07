const { TableClient } = require("@azure/data-tables");
const {
  listWorkflowDashboardMetricsByDateRangePostgres,
  listWorkflowDashboardMetricsByWorkflowRangePostgres,
  upsertWorkflowDashboardMetricsPostgres,
} = require("./postgresWorkflowDashboardStore");

const {
  buildHumanReadableDateTime,
  buildRunDate,
  getEnvironmentLabel,
} = require("./workflowRunLogStore");

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

function buildByDayPartitionKey({ environment, monthKey }) {
  return `${environment}|${monthKey}`;
}

function buildByDayRowKey({ runDate, workflowName }) {
  return `${runDate}|${workflowName}`;
}

function buildByWorkflowPartitionKey({ environment, workflowName, monthKey }) {
  return `${environment}|${workflowName}|${monthKey}`;
}

function buildByWorkflowRowKey({ runDate }) {
  return runDate;
}

function parseJsonMap(value) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeCountMaps(left = {}, right = {}) {
  const merged = { ...left };

  for (const [key, value] of Object.entries(right || {})) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      continue;
    }

    merged[key] = Number(merged[key] || 0) + value;
  }

  return merged;
}

function incrementCount(map, key, amount = 1) {
  if (!key) {
    return map;
  }

  map[key] = Number(map[key] || 0) + amount;
  return map;
}

function countDetailsChanges(details = {}) {
  const changes = Array.isArray(details.changes) ? details.changes : [];
  return changes.length;
}

function buildDashboardRunDelta({
  workflowName,
  finishedAt,
  status,
  summary,
  comparisonRecords = [],
}) {
  const runDate = buildRunDate(finishedAt);
  const actionDecisionCounts = {};
  const recordTypeCounts = {};
  const entityTypeCounts = {};
  const fieldCounts = {};
  const stageCounts = {};
  const skipReasonCounts = {};
  let updatedCount = 0;
  let wouldUpdateCount = 0;
  let sentEmailCount = 0;
  let wouldSendEmailCount = 0;
  let skippedActionCount = 0;
  let fieldChangeCount = 0;

  for (const record of comparisonRecords) {
    const details = record.details || {};
    const actionDecision = record.actionDecision || "unknown";

    incrementCount(actionDecisionCounts, actionDecision);
    incrementCount(recordTypeCounts, record.recordType || "unknown");
    incrementCount(entityTypeCounts, record.entityType || "unknown");

    if (actionDecision === "updated") {
      updatedCount += 1;
    } else if (actionDecision === "would-update") {
      wouldUpdateCount += 1;
    } else if (actionDecision === "sent-email") {
      sentEmailCount += 1;
    } else if (actionDecision === "would-send-email") {
      wouldSendEmailCount += 1;
    } else if (actionDecision.startsWith("skipped")) {
      skippedActionCount += 1;
      incrementCount(skipReasonCounts, actionDecision);
    }

    fieldChangeCount += countDetailsChanges(details);
    for (const change of details.changes || []) {
      incrementCount(fieldCounts, change?.field || change);
    }

    incrementCount(stageCounts, details.stage || null);
  }

  return {
    workflowName,
    runDate,
    monthKey: buildMonthKey(runDate),
    totalRuns: 1,
    successfulRuns: status === "success" ? 1 : 0,
    failedRuns: status === "success" ? 0 : 1,
    successCount: Number(summary.successCount || 0),
    failureCount: Number(summary.failureCount || 0),
    skippedCount: Number(summary.skippedCount || 0),
    comparisonRecordCount: comparisonRecords.length,
    updatedCount,
    wouldUpdateCount,
    sentEmailCount,
    wouldSendEmailCount,
    totalEmailCount: sentEmailCount + wouldSendEmailCount,
    skippedActionCount,
    fieldChangeCount,
    actionDecisionCounts,
    recordTypeCounts,
    entityTypeCounts,
    fieldCounts,
    stageCounts,
    skipReasonCounts,
    firstRunAt: finishedAt,
    lastRunAt: finishedAt,
    lastRunAtDisplay: buildHumanReadableDateTime(finishedAt) || "",
    lastRunStatus: status,
    lastSummary: summary.summary || "",
    artifactPath: summary.artifactPath || "",
    lastUpdatedAt: new Date().toISOString(),
  };
}

function parseMetricEntity(entity) {
  if (!entity) {
    return null;
  }

  return {
    environment: entity.environment || null,
    workflowName: entity.workflowName || null,
    runDate: entity.runDate || null,
    monthKey: entity.monthKey || null,
    totalRuns: Number(entity.totalRuns || 0),
    successfulRuns: Number(entity.successfulRuns || 0),
    failedRuns: Number(entity.failedRuns || 0),
    successCount: Number(entity.successCount || 0),
    failureCount: Number(entity.failureCount || 0),
    skippedCount: Number(entity.skippedCount || 0),
    comparisonRecordCount: Number(entity.comparisonRecordCount || 0),
    updatedCount: Number(entity.updatedCount || 0),
    wouldUpdateCount: Number(entity.wouldUpdateCount || 0),
    sentEmailCount: Number(entity.sentEmailCount || 0),
    wouldSendEmailCount: Number(entity.wouldSendEmailCount || 0),
    totalEmailCount: Number(entity.totalEmailCount || 0),
    skippedActionCount: Number(entity.skippedActionCount || 0),
    fieldChangeCount: Number(entity.fieldChangeCount || 0),
    actionDecisionCounts: parseJsonMap(entity.actionDecisionCountsJson),
    recordTypeCounts: parseJsonMap(entity.recordTypeCountsJson),
    entityTypeCounts: parseJsonMap(entity.entityTypeCountsJson),
    fieldCounts: parseJsonMap(entity.fieldCountsJson),
    stageCounts: parseJsonMap(entity.stageCountsJson),
    skipReasonCounts: parseJsonMap(entity.skipReasonCountsJson),
    firstRunAt: entity.firstRunAt || null,
    lastRunAt: entity.lastRunAt || null,
    lastRunAtDisplay: entity.lastRunAtDisplay || null,
    lastRunStatus: entity.lastRunStatus || null,
    lastSummary: entity.lastSummary || null,
    artifactPath: entity.artifactPath || null,
    lastUpdatedAt: entity.lastUpdatedAt || null,
  };
}

function mergeMetrics(existing, delta) {
  const merged = {
    workflowName: delta.workflowName,
    runDate: delta.runDate,
    monthKey: delta.monthKey,
    totalRuns: Number(existing?.totalRuns || 0) + delta.totalRuns,
    successfulRuns: Number(existing?.successfulRuns || 0) + delta.successfulRuns,
    failedRuns: Number(existing?.failedRuns || 0) + delta.failedRuns,
    successCount: Number(existing?.successCount || 0) + delta.successCount,
    failureCount: Number(existing?.failureCount || 0) + delta.failureCount,
    skippedCount: Number(existing?.skippedCount || 0) + delta.skippedCount,
    comparisonRecordCount:
      Number(existing?.comparisonRecordCount || 0) + delta.comparisonRecordCount,
    updatedCount: Number(existing?.updatedCount || 0) + delta.updatedCount,
    wouldUpdateCount: Number(existing?.wouldUpdateCount || 0) + delta.wouldUpdateCount,
    sentEmailCount: Number(existing?.sentEmailCount || 0) + delta.sentEmailCount,
    wouldSendEmailCount:
      Number(existing?.wouldSendEmailCount || 0) + delta.wouldSendEmailCount,
    totalEmailCount: Number(existing?.totalEmailCount || 0) + delta.totalEmailCount,
    skippedActionCount:
      Number(existing?.skippedActionCount || 0) + delta.skippedActionCount,
    fieldChangeCount: Number(existing?.fieldChangeCount || 0) + delta.fieldChangeCount,
    actionDecisionCounts: mergeCountMaps(existing?.actionDecisionCounts, delta.actionDecisionCounts),
    recordTypeCounts: mergeCountMaps(existing?.recordTypeCounts, delta.recordTypeCounts),
    entityTypeCounts: mergeCountMaps(existing?.entityTypeCounts, delta.entityTypeCounts),
    fieldCounts: mergeCountMaps(existing?.fieldCounts, delta.fieldCounts),
    stageCounts: mergeCountMaps(existing?.stageCounts, delta.stageCounts),
    skipReasonCounts: mergeCountMaps(existing?.skipReasonCounts, delta.skipReasonCounts),
    firstRunAt:
      existing?.firstRunAt && String(existing.firstRunAt) < String(delta.firstRunAt)
        ? existing.firstRunAt
        : delta.firstRunAt,
    lastRunAt:
      existing?.lastRunAt && String(existing.lastRunAt) > String(delta.lastRunAt)
        ? existing.lastRunAt
        : delta.lastRunAt,
    lastRunAtDisplay: delta.lastRunAtDisplay,
    lastRunStatus: delta.lastRunStatus,
    lastSummary: delta.lastSummary,
    artifactPath: delta.artifactPath,
    lastUpdatedAt: delta.lastUpdatedAt,
  };

  return merged;
}

function buildMetricEntity({ environment, partitionKey, rowKey, metrics }) {
  return {
    partitionKey,
    rowKey,
    environment,
    workflowName: metrics.workflowName,
    runDate: metrics.runDate,
    monthKey: metrics.monthKey,
    totalRuns: metrics.totalRuns,
    successfulRuns: metrics.successfulRuns,
    failedRuns: metrics.failedRuns,
    successCount: metrics.successCount,
    failureCount: metrics.failureCount,
    skippedCount: metrics.skippedCount,
    comparisonRecordCount: metrics.comparisonRecordCount,
    updatedCount: metrics.updatedCount,
    wouldUpdateCount: metrics.wouldUpdateCount,
    sentEmailCount: metrics.sentEmailCount,
    wouldSendEmailCount: metrics.wouldSendEmailCount,
    totalEmailCount: metrics.totalEmailCount,
    skippedActionCount: metrics.skippedActionCount,
    fieldChangeCount: metrics.fieldChangeCount,
    actionDecisionCountsJson: JSON.stringify(metrics.actionDecisionCounts || {}),
    recordTypeCountsJson: JSON.stringify(metrics.recordTypeCounts || {}),
    entityTypeCountsJson: JSON.stringify(metrics.entityTypeCounts || {}),
    fieldCountsJson: JSON.stringify(metrics.fieldCounts || {}),
    stageCountsJson: JSON.stringify(metrics.stageCounts || {}),
    skipReasonCountsJson: JSON.stringify(metrics.skipReasonCounts || {}),
    firstRunAt: metrics.firstRunAt || "",
    lastRunAt: metrics.lastRunAt || "",
    lastRunAtDisplay: metrics.lastRunAtDisplay || "",
    lastRunStatus: metrics.lastRunStatus || "",
    lastSummary: metrics.lastSummary || "",
    artifactPath: metrics.artifactPath || "",
    lastUpdatedAt: metrics.lastUpdatedAt || "",
  };
}

let cachedClients = new Map();
let ensureTablePromises = new Map();

function getClient({ config, tableName }) {
  const connectionString = config.AZURE_TABLE_STORAGE_CONNECTION_STRING;

  if (!connectionString || !tableName) {
    return null;
  }

  if (!isLikelyConnectionString(connectionString)) {
    throw new Error(
      "AZURE_TABLE_STORAGE_CONNECTION_STRING must be a full Azure Storage connection string",
    );
  }

  const cacheKey = `${tableName}|${connectionString}`;
  if (cachedClients.has(cacheKey)) {
    return cachedClients.get(cacheKey);
  }

  const client = TableClient.fromConnectionString(connectionString, tableName);
  cachedClients.set(cacheKey, client);
  ensureTablePromises.delete(cacheKey);

  return client;
}

async function ensureTable({ client }) {
  const cacheKey = `${client.tableName}|${client.url}`;
  if (!ensureTablePromises.has(cacheKey)) {
    ensureTablePromises.set(
      cacheKey,
      client.createTable().catch((error) => {
        if (error.statusCode === 409) {
          return;
        }
        throw error;
      }),
    );
  }

  await ensureTablePromises.get(cacheKey);
}

async function getEntitySafe({ client, partitionKey, rowKey }) {
  try {
    return await client.getEntity(partitionKey, rowKey);
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function writeWorkflowDashboardMetrics({
  config,
  logger,
  workflowName,
  finishedAt,
  status,
  summary,
  comparisonRecords,
}) {
  const byDayClient = getClient({
    config,
    tableName: config.AZURE_WORKFLOW_DASHBOARD_BY_DAY_TABLE_NAME,
  });
  const byWorkflowClient = getClient({
    config,
    tableName: config.AZURE_WORKFLOW_DASHBOARD_BY_WORKFLOW_TABLE_NAME,
  });

  if (!byDayClient || !byWorkflowClient) {
    return { skipped: true, reason: "table-storage-not-configured" };
  }

  await ensureTable({ client: byDayClient });
  await ensureTable({ client: byWorkflowClient });

  const environment = getEnvironmentLabel(config);
  const delta = buildDashboardRunDelta({
    workflowName,
    finishedAt,
    status,
    summary,
    comparisonRecords,
  });

  const byDayPartitionKey = buildByDayPartitionKey({
    environment,
    monthKey: delta.monthKey,
  });
  const byDayRowKey = buildByDayRowKey({
    runDate: delta.runDate,
    workflowName,
  });
  const byWorkflowPartitionKey = buildByWorkflowPartitionKey({
    environment,
    workflowName,
    monthKey: delta.monthKey,
  });
  const byWorkflowRowKey = buildByWorkflowRowKey({
    runDate: delta.runDate,
  });

  const [existingByDay, existingByWorkflow] = await Promise.all([
    getEntitySafe({ client: byDayClient, partitionKey: byDayPartitionKey, rowKey: byDayRowKey }),
    getEntitySafe({
      client: byWorkflowClient,
      partitionKey: byWorkflowPartitionKey,
      rowKey: byWorkflowRowKey,
    }),
  ]);

  const mergedByDay = mergeMetrics(parseMetricEntity(existingByDay), delta);
  const mergedByWorkflow = mergeMetrics(parseMetricEntity(existingByWorkflow), delta);

  await Promise.all([
    byDayClient.upsertEntity(
      buildMetricEntity({
        environment,
        partitionKey: byDayPartitionKey,
        rowKey: byDayRowKey,
        metrics: mergedByDay,
      }),
      "Replace",
    ),
    byWorkflowClient.upsertEntity(
      buildMetricEntity({
        environment,
        partitionKey: byWorkflowPartitionKey,
        rowKey: byWorkflowRowKey,
        metrics: mergedByWorkflow,
      }),
      "Replace",
    ),
  ]);

  logger.info(
    {
      workflowName,
      runDate: delta.runDate,
      byDayTable: config.AZURE_WORKFLOW_DASHBOARD_BY_DAY_TABLE_NAME,
      byWorkflowTable: config.AZURE_WORKFLOW_DASHBOARD_BY_WORKFLOW_TABLE_NAME,
    },
    "Workflow dashboard metrics written to Azure Table Storage",
  );

  return {
    skipped: false,
    runDate: delta.runDate,
    workflowName,
  };
}

async function writeWorkflowDashboardMetricsSafe(args) {
  const results = [];
  const errors = [];
  const environment = getEnvironmentLabel(args.config);
  const delta = buildDashboardRunDelta({
    workflowName: args.workflowName,
    finishedAt: args.finishedAt,
    status: args.status,
    summary: args.summary,
    comparisonRecords: args.comparisonRecords,
  });

  try {
    const azureResult = await writeWorkflowDashboardMetrics(args);
    results.push({ target: "azure-table", ...azureResult });
  } catch (error) {
    errors.push(error);
    results.push({
      target: "azure-table",
      skipped: true,
      reason: "table-storage-write-failed",
      error: error.message,
    });
  }

  if (args.config.POSTGRES_CONNECTION_STRING) {
    try {
      const existingByDay = await listWorkflowDashboardMetricsByDateRangePostgres({
        config: args.config,
        dateFrom: delta.runDate,
        dateTo: delta.runDate,
        workflowName: args.workflowName,
      });
      const existingByWorkflow = await listWorkflowDashboardMetricsByWorkflowRangePostgres({
        config: args.config,
        workflowName: args.workflowName,
        dateFrom: delta.runDate,
        dateTo: delta.runDate,
      });

      const mergedByDay = mergeMetrics(
        existingByDay.find(
          (record) =>
            record.environment === environment &&
            record.runDate === delta.runDate &&
            record.workflowName === args.workflowName,
        ) || null,
        delta,
      );
      const mergedByWorkflow = mergeMetrics(
        existingByWorkflow.find(
          (record) =>
            record.environment === environment &&
            record.runDate === delta.runDate &&
            record.workflowName === args.workflowName,
        ) || null,
        delta,
      );

      const postgresResult = await upsertWorkflowDashboardMetricsPostgres({
        config: args.config,
        logger: args.logger,
        byDayMetrics: mergedByDay,
        byWorkflowMetrics: mergedByWorkflow,
      });
      results.push({ target: "postgres", ...postgresResult });
    } catch (error) {
      errors.push(error);
      results.push({
        target: "postgres",
        skipped: true,
        reason: "postgres-write-failed",
        error: error.message,
      });
    }
  }

  if (results.some((result) => !result.skipped)) {
    return {
      skipped: false,
      results,
    };
  }

  if (errors.length > 0) {
    args.logger.warn(
      {
        workflowName: args.workflowName,
        message: errors[0].message,
      },
      "Skipping workflow dashboard metrics write because all reporting writes failed",
    );
  }

  return {
    skipped: true,
    results,
  };
}

function formatDateOnly(value) {
  return String(value).slice(0, 10);
}

function parseDateOnly(value) {
  const normalized = formatDateOnly(value);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function listMonthsBetween(dateFrom, dateTo) {
  const months = [];
  const current = new Date(Date.UTC(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth(), 1));
  const end = new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), 1));

  while (current.getTime() <= end.getTime()) {
    months.push(current.toISOString().slice(0, 7));
    current.setUTCMonth(current.getUTCMonth() + 1);
  }

  return months;
}

function nextDay(dateString) {
  const parsed = parseDateOnly(dateString);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

async function listWorkflowDashboardMetricsByDateRange({
  config,
  dateFrom,
  dateTo,
  workflowName = null,
}) {
  if (config.POSTGRES_CONNECTION_STRING) {
    const postgresEntities = await listWorkflowDashboardMetricsByDateRangePostgres({
      config,
      dateFrom,
      dateTo,
      workflowName,
    });
    if (postgresEntities.length > 0) {
      return postgresEntities;
    }
  }

  const client = getClient({
    config,
    tableName: config.AZURE_WORKFLOW_DASHBOARD_BY_DAY_TABLE_NAME,
  });
  if (!client) {
    return [];
  }

  await ensureTable({ client });

  const start = parseDateOnly(dateFrom);
  const end = parseDateOnly(dateTo);
  const workflowNames = workflowName
    ? String(workflowName)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : null;
  const workflowNameSet = workflowNames ? new Set(workflowNames) : null;
  const environment = getEnvironmentLabel(config);
  const entities = [];

  for (const monthKey of listMonthsBetween(start, end)) {
    const partitionKey = buildByDayPartitionKey({ environment, monthKey });
    for await (const entity of client.listEntities({
      queryOptions: {
        filter:
          `PartitionKey eq '${partitionKey.replace(/'/g, "''")}' and ` +
          `RowKey ge '${formatDateOnly(dateFrom)}' and RowKey lt '${nextDay(formatDateOnly(dateTo))}~'`,
      },
    })) {
      const parsed = parseMetricEntity(entity);
      if (workflowNameSet && !workflowNameSet.has(parsed.workflowName)) {
        continue;
      }
      entities.push(parsed);
    }
  }

  return entities.sort((left, right) =>
    `${left.runDate}|${left.workflowName}`.localeCompare(`${right.runDate}|${right.workflowName}`),
  );
}

async function listWorkflowDashboardMetricsByWorkflowRange({
  config,
  workflowName,
  dateFrom,
  dateTo,
}) {
  if (config.POSTGRES_CONNECTION_STRING) {
    const postgresEntities = await listWorkflowDashboardMetricsByWorkflowRangePostgres({
      config,
      workflowName,
      dateFrom,
      dateTo,
    });
    if (postgresEntities.length > 0) {
      return postgresEntities;
    }
  }

  const client = getClient({
    config,
    tableName: config.AZURE_WORKFLOW_DASHBOARD_BY_WORKFLOW_TABLE_NAME,
  });
  if (!client) {
    return [];
  }

  await ensureTable({ client });

  const start = parseDateOnly(dateFrom);
  const end = parseDateOnly(dateTo);
  const environment = getEnvironmentLabel(config);
  const entities = [];

  for (const monthKey of listMonthsBetween(start, end)) {
    const partitionKey = buildByWorkflowPartitionKey({
      environment,
      workflowName,
      monthKey,
    });
    for await (const entity of client.listEntities({
      queryOptions: {
        filter:
          `PartitionKey eq '${partitionKey.replace(/'/g, "''")}' and ` +
          `RowKey ge '${formatDateOnly(dateFrom)}' and RowKey le '${formatDateOnly(dateTo)}'`,
      },
    })) {
      entities.push(parseMetricEntity(entity));
    }
  }

  return entities.sort((left, right) => String(left.runDate).localeCompare(String(right.runDate)));
}

module.exports = {
  buildByDayPartitionKey,
  buildByDayRowKey,
  buildByWorkflowPartitionKey,
  buildByWorkflowRowKey,
  buildDashboardRunDelta,
  buildMonthKey,
  listMonthsBetween,
  listWorkflowDashboardMetricsByDateRange,
  listWorkflowDashboardMetricsByWorkflowRange,
  mergeMetrics,
  parseMetricEntity,
  writeWorkflowDashboardMetricsSafe,
  writeWorkflowDashboardMetrics,
};
