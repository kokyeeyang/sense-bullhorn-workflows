require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { getEnvironmentLabel } = require("./workflowRunLogStore");
const { listWorkflowComparisonRecordsForDate } = require("./workflowComparisonStore");
const { serializeError, writeJsonArtifact } = require("./workflowRuntime");

const DAILY_COMPARISON_WORKFLOWS = [
  "placement-status-sync",
  "placement-database-enrichment-sync",
  "placement-termination-email-sync",
  "interview-illinois-email-sync",
  "client-contact-dnc-sync",
  "client-corporation-360-sync",
  "client-corporation-key-account-sync",
];

function resolveSummaryDate(targetDate) {
  if (targetDate) {
    return String(targetDate).slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function summarizeWorkflowRecords(records) {
  const totals = {
    totalRecords: records.length,
    wouldUpdate: 0,
    updated: 0,
    wouldSendEmail: 0,
    sentEmail: 0,
    skipped: 0,
  };

  for (const record of records) {
    switch (record.actionDecision) {
      case "would-update":
        totals.wouldUpdate += 1;
        break;
      case "updated":
        totals.updated += 1;
        break;
      case "would-send-email":
        totals.wouldSendEmail += 1;
        break;
      case "sent-email":
        totals.sentEmail += 1;
        break;
      default:
        if (record.actionDecision && record.actionDecision.startsWith("skipped")) {
          totals.skipped += 1;
        }
        break;
    }
  }

  return totals;
}

function buildDailyComparisonSummary({ environment, summaryDate, workflowRecords }) {
  const workflows = workflowRecords.map(({ workflowName, records }) => ({
    workflowName,
    totals: summarizeWorkflowRecords(records),
    comparisonRecords: records,
  }));

  const totals = workflows.reduce(
    (aggregate, workflow) => {
      aggregate.workflowCount += 1;
      aggregate.totalRecords += workflow.totals.totalRecords;
      aggregate.wouldUpdate += workflow.totals.wouldUpdate;
      aggregate.updated += workflow.totals.updated;
      aggregate.wouldSendEmail += workflow.totals.wouldSendEmail;
      aggregate.sentEmail += workflow.totals.sentEmail;
      aggregate.skipped += workflow.totals.skipped;
      return aggregate;
    },
    {
      workflowCount: 0,
      totalRecords: 0,
      wouldUpdate: 0,
      updated: 0,
      wouldSendEmail: 0,
      sentEmail: 0,
      skipped: 0,
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

async function writeDailyComparisonSummaryArtifact({ summary }) {
  return writeJsonArtifact({
    filePrefix: `workflow-comparison-daily-summary-${summary.summaryDate}`,
    payload: summary,
  });
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  const summaryDate = resolveSummaryDate(targetDate);
  const environment = getEnvironmentLabel(config);
  const workflowRecords = [];

  logger.info(
    {
      summaryDate,
      environment,
      workflowCount: DAILY_COMPARISON_WORKFLOWS.length,
    },
    "Starting daily workflow comparison summary run",
  );

  for (const workflowName of DAILY_COMPARISON_WORKFLOWS) {
    const records = await listWorkflowComparisonRecordsForDate({
      config,
      workflowName,
      runDate: summaryDate,
    });
    workflowRecords.push({
      workflowName,
      records,
    });
  }

  const summary = buildDailyComparisonSummary({
    environment,
    summaryDate,
    workflowRecords,
  });
  const reportPath = await writeDailyComparisonSummaryArtifact({ summary });

  logger.info(
    {
      summaryDate,
      environment,
      workflowCount: summary.totals.workflowCount,
      totalRecords: summary.totals.totalRecords,
      reportPath,
    },
    "Daily workflow comparison summary written",
  );

  return {
    summaryDate,
    environment,
    totals: summary.totals,
    workflows: summary.workflows,
    artifacts: {
      reportPath,
    },
  };
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Daily workflow comparison summary run failed");
    process.exitCode = 1;
  });
}

module.exports = {
  DAILY_COMPARISON_WORKFLOWS,
  buildDailyComparisonSummary,
  resolveSummaryDate,
  run,
};
