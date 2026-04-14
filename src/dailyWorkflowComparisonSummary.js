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

function parseDateOnly(value, label) {
  const normalized = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function resolveSummaryDates({ targetDate, dateFrom, dateTo }) {
  if (targetDate && (dateFrom || dateTo)) {
    throw new Error("Use either targetDate or dateFrom/dateTo, not both");
  }

  if (!dateFrom && !dateTo) {
    return [resolveSummaryDate(targetDate)];
  }

  if (!dateFrom || !dateTo) {
    throw new Error("Both dateFrom and dateTo are required when using a date range");
  }

  const start = parseDateOnly(dateFrom, "dateFrom");
  const end = parseDateOnly(dateTo, "dateTo");
  if (start.getTime() > end.getTime()) {
    throw new Error("dateFrom must be on or before dateTo");
  }

  const dates = [];
  const current = new Date(start);
  while (current.getTime() <= end.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function resolveWorkflowNames(workflowName) {
  if (!workflowName) {
    return DAILY_COMPARISON_WORKFLOWS;
  }

  const normalized = String(workflowName).trim();
  if (!DAILY_COMPARISON_WORKFLOWS.includes(normalized)) {
    throw new Error(`Unsupported workflowName filter: ${normalized}`);
  }

  return [normalized];
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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function compareRunTimestamps(left, right) {
  const leftTime = left?.runTimestamp ? new Date(left.runTimestamp).getTime() : 0;
  const rightTime = right?.runTimestamp ? new Date(right.runTimestamp).getTime() : 0;
  return leftTime - rightTime;
}

function buildDedupKey(record) {
  return [
    record.workflowName || "",
    record.recordType || "",
    record.actionDecision || "",
    record.entityType || "",
    record.entityId ?? "",
    record.candidateId ?? "",
    record.relatedId ?? "",
    stableStringify(record.details || {}),
  ].join("|");
}

function dedupeWorkflowRecords(records) {
  const deduped = new Map();

  for (const record of records) {
    const key = buildDedupKey(record);
    const existing = deduped.get(key);
    if (!existing || compareRunTimestamps(existing, record) <= 0) {
      deduped.set(key, record);
    }
  }

  return [...deduped.values()].sort((left, right) => compareRunTimestamps(left, right));
}

function buildDailyComparisonSummary({ environment, summaryDate, workflowRecords, includeRecords }) {
  const workflows = workflowRecords.map(({ workflowName, records }) => {
    const comparisonRecords = dedupeWorkflowRecords(records);

    return {
      workflowName,
      totals: summarizeWorkflowRecords(comparisonRecords),
      rawRecordCount: records.length,
      dedupedRecordCount: comparisonRecords.length,
      ...(includeRecords ? { comparisonRecords } : {}),
    };
  });

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

function buildAggregateTotals(dateSummaries) {
  return dateSummaries.reduce(
    (aggregate, summary) => {
      aggregate.dateCount += 1;
      aggregate.workflowCount = Math.max(aggregate.workflowCount, summary.totals.workflowCount);
      aggregate.totalRecords += summary.totals.totalRecords;
      aggregate.wouldUpdate += summary.totals.wouldUpdate;
      aggregate.updated += summary.totals.updated;
      aggregate.wouldSendEmail += summary.totals.wouldSendEmail;
      aggregate.sentEmail += summary.totals.sentEmail;
      aggregate.skipped += summary.totals.skipped;
      return aggregate;
    },
    {
      dateCount: 0,
      workflowCount: 0,
      totalRecords: 0,
      wouldUpdate: 0,
      updated: 0,
      wouldSendEmail: 0,
      sentEmail: 0,
      skipped: 0,
    },
  );
}

async function writeDailyComparisonSummaryArtifact({ summary }) {
  const suffix = summary.summaryDate || `${summary.dateFrom}-to-${summary.dateTo}`;
  return writeJsonArtifact({
    filePrefix: `workflow-comparison-daily-summary-${suffix}`,
    payload: summary,
  });
}

async function run({ targetDate, workflowName, dateFrom, dateTo, includeRecords = false } = {}) {
  const config = loadConfig();
  const summaryDates = resolveSummaryDates({ targetDate, dateFrom, dateTo });
  const workflowNames = resolveWorkflowNames(workflowName);
  const environment = getEnvironmentLabel(config);
  const dateSummaries = [];

  logger.info(
    {
      summaryDates,
      environment,
      workflowCount: workflowNames.length,
      workflowName: workflowName || null,
    },
    "Starting daily workflow comparison summary run",
  );

  for (const summaryDate of summaryDates) {
    const workflowRecords = [];
    for (const currentWorkflowName of workflowNames) {
      const records = await listWorkflowComparisonRecordsForDate({
        config,
        workflowName: currentWorkflowName,
        runDate: summaryDate,
      });
      workflowRecords.push({
        workflowName: currentWorkflowName,
        records,
      });
    }

    dateSummaries.push(
      buildDailyComparisonSummary({
        environment,
        summaryDate,
        workflowRecords,
        includeRecords: true,
      }),
    );
  }

  const summary =
    dateSummaries.length === 1
      ? dateSummaries[0]
      : {
          generatedAt: new Date().toISOString(),
          environment,
          dateFrom: summaryDates[0],
          dateTo: summaryDates[summaryDates.length - 1],
          totals: buildAggregateTotals(dateSummaries),
          dateSummaries,
        };
  const reportPath = await writeDailyComparisonSummaryArtifact({ summary });

  logger.info(
    {
      summaryDate: dateSummaries.length === 1 ? dateSummaries[0].summaryDate : null,
      dateFrom: dateSummaries.length > 1 ? summaryDates[0] : null,
      dateTo: dateSummaries.length > 1 ? summaryDates[summaryDates.length - 1] : null,
      environment,
      workflowCount: summary.totals.workflowCount,
      totalRecords: summary.totals.totalRecords,
      reportPath,
    },
    "Daily workflow comparison summary written",
  );

  return {
    environment,
    ...(dateSummaries.length === 1
      ? {
          summaryDate: dateSummaries[0].summaryDate,
          workflows: dateSummaries[0].workflows.map((workflow) => ({
            workflowName: workflow.workflowName,
            totals: workflow.totals,
            rawRecordCount: workflow.rawRecordCount,
            dedupedRecordCount: workflow.dedupedRecordCount,
            ...(includeRecords ? { comparisonRecords: workflow.comparisonRecords || [] } : {}),
          })),
        }
      : {
          dateFrom: summaryDates[0],
          dateTo: summaryDates[summaryDates.length - 1],
          dateSummaries: dateSummaries.map((dateSummary) => ({
            summaryDate: dateSummary.summaryDate,
            totals: dateSummary.totals,
            workflows: dateSummary.workflows.map((workflow) => ({
              workflowName: workflow.workflowName,
              totals: workflow.totals,
              rawRecordCount: workflow.rawRecordCount,
              dedupedRecordCount: workflow.dedupedRecordCount,
              ...(includeRecords ? { comparisonRecords: workflow.comparisonRecords || [] } : {}),
            })),
          })),
        }),
    totals: summary.totals,
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
  buildAggregateTotals,
  buildDailyComparisonSummary,
  buildDedupKey,
  dedupeWorkflowRecords,
  resolveSummaryDate,
  resolveSummaryDates,
  resolveWorkflowNames,
  run,
};
