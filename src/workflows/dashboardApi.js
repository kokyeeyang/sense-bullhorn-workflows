const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { getEnvironmentLabel, listWorkflowRunLogsForDate } = require("../stores/workflowRunLogStore");
const { listWorkflowDashboardMetricsByDateRange } = require("../stores/workflowDashboardStore");
const {
  listWorkflowDataMutationAuditRecordsPostgres,
} = require("../stores/postgresWorkflowDataMutationAuditStore");
const {
  listWorkflowEmailTransmissionsPostgres,
} = require("../stores/postgresWorkflowEmailTransmissionStore");
const {
  listWorkflowSurveyResponsesPostgres,
} = require("../stores/postgresWorkflowSurveyStore");
const {
  buildAiMetricsContext,
  buildDashboardSummary,
  buildEmailSummary,
  buildSkipSummary,
  buildWorkflowCatalog,
  resolveDashboardFilters,
} = require("../utils/dashboardApiUtils");
const { serializeError } = require("../utils/workflowRuntime");

function parseBoolean(value) {
  return ["true", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function getQueryValue(request, key) {
  return request.query.get(key) || null;
}

function getPositiveIntegerQueryValue(request, key, fallback = 100) {
  const parsed = Number(request.query.get(key) || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function buildFiltersFromRequest(request) {
  return resolveDashboardFilters({
    dateFrom: getQueryValue(request, "dateFrom"),
    dateTo: getQueryValue(request, "dateTo"),
    month: getQueryValue(request, "month"),
    workflowName: getQueryValue(request, "workflowName"),
    category: getQueryValue(request, "category"),
    status: getQueryValue(request, "status"),
    actionDecision: getQueryValue(request, "actionDecision"),
    includeRecords: parseBoolean(getQueryValue(request, "includeRecords")),
  });
}

async function readDashboardMetricRecords({ config, filters }) {
  return listWorkflowDashboardMetricsByDateRange({
    config,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    workflowName: filters.workflowNames.length > 0 ? filters.workflowNames.join(",") : null,
  });
}

function buildJsonResponse(status, payload) {
  return {
    status,
    jsonBody: payload,
  };
}

function buildErrorResponse({ error, status = 500 }) {
  return buildJsonResponse(status, {
    success: false,
    error: {
      message: error.message || "Dashboard API request failed",
      name: error.name || "Error",
    },
  });
}

async function handleDashboardWorkflows(request, context) {
  context.log("Dashboard workflows request received");
  const config = loadConfig();
  return buildJsonResponse(200, {
    success: true,
    generatedAt: new Date().toISOString(),
    environment: getEnvironmentLabel(config),
    workflows: buildWorkflowCatalog(),
  });
}

async function handleDashboardSummary(request, context) {
  context.log("Dashboard summary request received");

  try {
    const config = loadConfig();
    const filters = buildFiltersFromRequest(request);
    const records = await readDashboardMetricRecords({ config, filters });
    const summary = buildDashboardSummary({
      records,
      filters,
      environment: getEnvironmentLabel(config),
    });

    return buildJsonResponse(200, {
      success: true,
      data: summary,
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard summary request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

async function handleDashboardTrends(request, context) {
  context.log("Dashboard trends request received");

  try {
    const config = loadConfig();
    const filters = buildFiltersFromRequest(request);
    const records = await readDashboardMetricRecords({ config, filters });
    const summary = buildDashboardSummary({
      records,
      filters,
      environment: getEnvironmentLabel(config),
    });

    return buildJsonResponse(200, {
      success: true,
      data: {
        generatedAt: summary.generatedAt,
        environment: summary.environment,
        filters: summary.filters,
        totals: summary.totals,
        trends: summary.trends,
      },
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard trends request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

async function handleDashboardEmails(request, context) {
  context.log("Dashboard email metrics request received");

  try {
    const config = loadConfig();
    const filters = buildFiltersFromRequest(request);
    const records = await readDashboardMetricRecords({ config, filters });
    const summary = buildEmailSummary({
      records,
      filters,
      environment: getEnvironmentLabel(config),
    });

    return buildJsonResponse(200, {
      success: true,
      data: summary,
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard email metrics request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

async function handleDashboardSkips(request, context) {
  context.log("Dashboard skip metrics request received");

  try {
    const config = loadConfig();
    const filters = buildFiltersFromRequest(request);
    const records = await readDashboardMetricRecords({ config, filters });
    const summary = buildSkipSummary({
      records,
      filters,
      environment: getEnvironmentLabel(config),
    });

    return buildJsonResponse(200, {
      success: true,
      data: summary,
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard skip metrics request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

function listDateStrings(dateFrom, dateTo) {
  const dates = [];
  const current = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);
  while (current.getTime() <= end.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function handleDashboardRuns(request, context) {
  context.log("Dashboard run log request received");

  try {
    const config = loadConfig();
    const filters = buildFiltersFromRequest(request);
    const workflowNames =
      filters.workflowNames.length > 0
        ? filters.workflowNames
        : buildWorkflowCatalog().map((workflow) => workflow.workflowName);
    const dates = listDateStrings(filters.dateFrom, filters.dateTo);
    const runs = [];

    for (const workflowName of workflowNames) {
      for (const runDate of dates) {
        const dayRuns = await listWorkflowRunLogsForDate({ config, workflowName, runDate });
        for (const run of dayRuns) {
          if (filters.status && run.status !== filters.status) {
            continue;
          }
          runs.push(run);
        }
      }
    }

    runs.sort((left, right) => String(right.finishedAt || "").localeCompare(String(left.finishedAt || "")));

    return buildJsonResponse(200, {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        environment: getEnvironmentLabel(config),
        filters,
        count: runs.length,
        runs,
      },
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard run log request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

async function handleDashboardAiContext(request, context) {
  context.log("Dashboard AI metrics context request received");

  try {
    const config = loadConfig();
    const filters = {
      ...buildFiltersFromRequest(request),
      includeRecords: false,
    };
    const records = await readDashboardMetricRecords({ config, filters });
    const summary = buildDashboardSummary({
      records,
      filters,
      environment: getEnvironmentLabel(config),
    });

    return buildJsonResponse(200, {
      success: true,
      data: buildAiMetricsContext({ summary }),
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard AI metrics context request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

async function handleDashboardDataMutations(request, context) {
  context.log("Dashboard data mutation audit request received");

  try {
    const config = loadConfig();
    const filters = buildFiltersFromRequest(request);
    const records = await listWorkflowDataMutationAuditRecordsPostgres({
      config,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      workflowName: filters.workflowNames.length > 0 ? filters.workflowNames.join(",") : getQueryValue(request, "workflowName"),
      action: getQueryValue(request, "action") || filters.actionDecision,
      entityType: getQueryValue(request, "entityType"),
      fieldName: getQueryValue(request, "fieldName"),
      candidateId: getQueryValue(request, "candidateId"),
      entityId: getQueryValue(request, "entityId"),
      limit: getPositiveIntegerQueryValue(request, "limit", 100),
    });

    return buildJsonResponse(200, {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        environment: getEnvironmentLabel(config),
        filters,
        count: records.length,
        records,
        storage: config.POSTGRES_CONNECTION_STRING ? "postgres" : "none",
      },
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard data mutation audit request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

async function handleDashboardEmailTransmissions(request, context) {
  context.log("Dashboard email transmission detail request received");

  try {
    const config = loadConfig();
    const filters = buildFiltersFromRequest(request);
    const records = await listWorkflowEmailTransmissionsPostgres({
      config,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      workflowName:
        filters.workflowNames.length > 0 ? filters.workflowNames.join(",") : getQueryValue(request, "workflowName"),
      sendType: getQueryValue(request, "sendType"),
      recipientEmail: getQueryValue(request, "recipientEmail"),
      fromEmail: getQueryValue(request, "fromEmail"),
      subject: getQueryValue(request, "subject"),
      limit: getPositiveIntegerQueryValue(request, "limit", 100),
    });

    return buildJsonResponse(200, {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        environment: getEnvironmentLabel(config),
        filters,
        count: records.length,
        records,
        storage: config.POSTGRES_CONNECTION_STRING ? "postgres" : "none",
      },
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard email transmission detail request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

async function handleDashboardSurveyResponses(request, context) {
  context.log("Dashboard survey responses detail request received");

  try {
    const config = loadConfig();
    const filters = buildFiltersFromRequest(request);
    const records = await listWorkflowSurveyResponsesPostgres({
      config,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      workflowName:
        filters.workflowNames.length > 0 ? filters.workflowNames.join(",") : getQueryValue(request, "workflowName"),
      surveyKey: getQueryValue(request, "surveyKey"),
      recipientEmail: getQueryValue(request, "recipientEmail"),
      answer: getQueryValue(request, "answer"),
      limit: getPositiveIntegerQueryValue(request, "limit", 100),
    });

    return buildJsonResponse(200, {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        environment: getEnvironmentLabel(config),
        filters,
        count: records.length,
        records,
        storage: config.POSTGRES_CONNECTION_STRING ? "postgres" : "none",
      },
    });
  } catch (error) {
    context.error(serializeError(error), "Dashboard survey responses detail request failed");
    return buildErrorResponse({
      error,
      status: error.message?.startsWith("Invalid") || error.message?.includes("Unsupported") ? 400 : 500,
    });
  }
}

module.exports = {
  handleDashboardAiContext,
  handleDashboardDataMutations,
  handleDashboardEmails,
  handleDashboardEmailTransmissions,
  handleDashboardRuns,
  handleDashboardSkips,
  handleDashboardSummary,
  handleDashboardSurveyResponses,
  handleDashboardTrends,
  handleDashboardWorkflows,
};
