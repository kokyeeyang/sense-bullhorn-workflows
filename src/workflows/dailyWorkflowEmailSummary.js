require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { getEnvironmentLabel } = require("../stores/workflowRunLogStore");
const { listWorkflowDashboardMetricsByDateRange } = require("../stores/workflowDashboardStore");
const { DASHBOARD_EMAIL_WORKFLOWS } = require("../utils/dashboardWorkflows");
const { serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const DAILY_EMAIL_WORKFLOWS = DASHBOARD_EMAIL_WORKFLOWS;

function resolveSummaryDate(targetDate) {
  if (targetDate) {
    return String(targetDate).slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function resolveWorkflowNames(workflowName) {
  if (!workflowName) {
    return DAILY_EMAIL_WORKFLOWS;
  }

  const normalized = String(workflowName).trim();
  if (!DAILY_EMAIL_WORKFLOWS.includes(normalized)) {
    throw new Error(`Unsupported workflowName filter: ${normalized}`);
  }

  return [normalized];
}

function summarizeWorkflowRecords(records) {
  const totals = {
    totalEmails: 0,
    wouldSendEmail: 0,
    sentEmail: 0,
  };

  for (const record of records) {
    totals.totalEmails += Number(record.totalEmailCount || 0);
    totals.wouldSendEmail += Number(record.wouldSendEmailCount || 0);
    totals.sentEmail += Number(record.sentEmailCount || 0);
  }

  return totals;
}

function buildDailyEmailSummary({ environment, summaryDate, workflowRecords, includeRecords }) {
  const workflows = workflowRecords.map(({ workflowName, records }) => ({
    workflowName,
    totals: summarizeWorkflowRecords(records),
    totalRecipientRows: records.reduce(
      (sum, record) => sum + Number(record.totalEmailCount || 0),
      0,
    ),
    ...(includeRecords ? { emailRecords: records } : {}),
  }));

  const totals = workflows.reduce(
    (aggregate, workflow) => {
      aggregate.workflowCount += 1;
      aggregate.totalEmails += workflow.totals.totalEmails;
      aggregate.wouldSendEmail += workflow.totals.wouldSendEmail;
      aggregate.sentEmail += workflow.totals.sentEmail;
      return aggregate;
    },
    {
      workflowCount: 0,
      totalEmails: 0,
      wouldSendEmail: 0,
      sentEmail: 0,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    summaryDate,
    environment,
    totals,
    workflows,
  };
}

async function writeDailyEmailSummaryArtifact({ summary }) {
  const suffix = summary.summaryDate || `${summary.dateFrom}-to-${summary.dateTo}`;
  return writeJsonArtifact({
    filePrefix: `workflow-daily-email-summary-${suffix}`,
    payload: summary,
  });
}

async function run({ targetDate, workflowName, includeRecords = false } = {}) {
  const config = loadConfig();
  const summaryDate = resolveSummaryDate(targetDate);
  const workflowNames = resolveWorkflowNames(workflowName);
  const environment = getEnvironmentLabel(config);
  const workflowRecords = [];

  logger.info(
    {
      summaryDate,
      environment,
      workflowCount: workflowNames.length,
      workflowName: workflowName || null,
      includeRecords,
    },
    "Starting daily workflow email summary run",
  );

  for (const currentWorkflowName of workflowNames) {
    const records = await listWorkflowDashboardMetricsByDateRange({
      config,
      workflowName: currentWorkflowName,
      dateFrom: summaryDate,
      dateTo: summaryDate,
    });
    workflowRecords.push({
      workflowName: currentWorkflowName,
      records,
    });
  }

  const fullSummary = buildDailyEmailSummary({
    environment,
    summaryDate,
    workflowRecords,
    includeRecords: true,
  });
  const reportPath = await writeDailyEmailSummaryArtifact({ summary: fullSummary });

  logger.info(
    {
      summaryDate,
      environment,
      workflowCount: fullSummary.totals.workflowCount,
      totalEmails: fullSummary.totals.totalEmails,
      reportPath,
    },
    "Daily workflow email summary written",
  );

  return {
    environment,
    summaryDate,
    workflows: fullSummary.workflows.map((workflow) => ({
      workflowName: workflow.workflowName,
      totals: workflow.totals,
      totalRecipientRows: workflow.totalRecipientRows,
      ...(includeRecords ? { emailRecords: workflow.emailRecords || [] } : {}),
    })),
    totals: fullSummary.totals,
    artifacts: {
      reportPath,
    },
  };
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Daily workflow email summary run failed");
    process.exitCode = 1;
  });
}

module.exports = {
  DAILY_EMAIL_WORKFLOWS,
  buildDailyEmailSummary,
  resolveSummaryDate,
  resolveWorkflowNames,
  run,
};
