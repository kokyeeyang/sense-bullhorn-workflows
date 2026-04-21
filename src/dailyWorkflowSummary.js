require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { SparkPostClient } = require("./sparkPostClient");
const {
  buildHumanReadableDateTime,
  getEnvironmentLabel,
  listWorkflowRunLogsForDate,
} = require("./workflowRunLogStore");
const { serializeError, writeJsonArtifact } = require("./workflowRuntime");

const DAILY_SUMMARY_WORKFLOWS = [
  "placement-status-sync",
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

function resolveWorkflowNames(workflowName) {
  if (!workflowName) {
    return DAILY_SUMMARY_WORKFLOWS;
  }

  const normalized = String(workflowName).trim();
  if (!DAILY_SUMMARY_WORKFLOWS.includes(normalized)) {
    throw new Error(`Unsupported workflowName filter: ${normalized}`);
  }

  return [normalized];
}

function parseDetails(detailsJson) {
  if (!detailsJson) {
    return {};
  }

  try {
    return JSON.parse(detailsJson);
  } catch {
    return {};
  }
}

function buildWorkflowDailySummary({ workflowName, runDate, entities }) {
  const sortedEntities = [...entities].sort((left, right) =>
    String(left.finishedAt || left.rowKey).localeCompare(String(right.finishedAt || right.rowKey)),
  );

  const totals = {
    totalRuns: sortedEntities.length,
    successfulRuns: 0,
    failedRuns: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
  };

  const runFailures = [];

  for (const entity of sortedEntities) {
    const status = entity.status || "unknown";
    if (status === "success") {
      totals.successfulRuns += 1;
    } else {
      totals.failedRuns += 1;
    }

    totals.successCount += Number(entity.successCount || 0);
    totals.failureCount += Number(entity.failureCount || 0);
    totals.skippedCount += Number(entity.skippedCount || 0);

    if (status !== "success") {
      const details = parseDetails(entity.detailsJson);
      runFailures.push({
        finishedAt: entity.finishedAt || null,
        summary: entity.summary || null,
        message: details.message || null,
      });
    }
  }

  return {
    environment: sortedEntities[0]?.environment || null,
    workflowName,
    runDate,
    totals,
    runFailures,
    entities: sortedEntities.map((entity) => ({
      startedAt: entity.startedAt || null,
      finishedAt: entity.finishedAt || null,
      startedAtDisplay:
        entity.startedAtDisplay || buildHumanReadableDateTime(entity.startedAt) || null,
      finishedAtDisplay:
        entity.finishedAtDisplay || buildHumanReadableDateTime(entity.finishedAt) || null,
      trigger: entity.trigger || null,
      status: entity.status || null,
      successCount: Number(entity.successCount || 0),
      failureCount: Number(entity.failureCount || 0),
      skippedCount: Number(entity.skippedCount || 0),
      summary: entity.summary || null,
      artifactPath: entity.artifactPath || null,
    })),
  };
}

function buildSummaryEmailContent(summary) {
  const lines = [
    `${summary.workflowName}`,
    `Date: ${summary.runDate}`,
    `Environment: ${summary.environment || "unknown"}`,
    `Runs: ${summary.totals.totalRuns} | Successful runs: ${summary.totals.successfulRuns} | Failed runs: ${summary.totals.failedRuns}`,
    `Items: successful=${summary.totals.successCount}, failed=${summary.totals.failureCount}, skipped=${summary.totals.skippedCount}`,
  ];

  if (summary.runFailures.length > 0) {
    lines.push("", "Failed runs:");
    for (const failure of summary.runFailures.slice(0, 10)) {
      const timestamp = buildHumanReadableDateTime(failure.finishedAt) || failure.finishedAt || "unknown time";
      const description = failure.message || failure.summary || "No failure details recorded";
      lines.push(`- ${timestamp}: ${description}`);
    }
  } else {
    lines.push("", "Failed runs: none");
  }

  if (summary.entities.length > 0) {
    lines.push("", "Recent runs:");
    for (const entity of summary.entities.slice(-5)) {
      lines.push(
        `- ${entity.finishedAtDisplay || entity.startedAtDisplay || "unknown"} | ${entity.status} | success=${entity.successCount}, failed=${entity.failureCount}, skipped=${entity.skippedCount}`,
      );
    }
  }

  const text = lines.join("\n");
  const html = [
    `<section style="margin: 0 0 28px;">`,
    `<h2 style="margin: 0 0 8px; font-size: 20px;">${summary.workflowName}</h2>`,
    `<p style="margin: 0 0 12px; color: #475467;">Date: <strong>${summary.runDate}</strong></p>`,
    `<p style="margin: 0 0 12px; color: #475467;">Environment: <strong>${summary.environment || "unknown"}</strong></p>`,
    `<table style="border-collapse: collapse; width: 100%; max-width: 720px; margin-bottom: 14px;">`,
    "<tr>",
    '<th style="text-align: left; border-bottom: 1px solid #d0d5dd; padding: 8px; background: #f8fafc;">Metric</th>',
    '<th style="text-align: left; border-bottom: 1px solid #d0d5dd; padding: 8px; background: #f8fafc;">Value</th>',
    "</tr>",
    `<tr><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">Total runs</td><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">${summary.totals.totalRuns}</td></tr>`,
    `<tr><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">Successful runs</td><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">${summary.totals.successfulRuns}</td></tr>`,
    `<tr><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">Failed runs</td><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">${summary.totals.failedRuns}</td></tr>`,
    `<tr><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">Successful items</td><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">${summary.totals.successCount}</td></tr>`,
    `<tr><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">Failed items</td><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">${summary.totals.failureCount}</td></tr>`,
    `<tr><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">Skipped items</td><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">${summary.totals.skippedCount}</td></tr>`,
    "</table>",
  ];

  if (summary.runFailures.length > 0) {
    html.push('<h3 style="margin: 16px 0 8px; font-size: 16px;">Failed runs</h3>', "<ul>");
    for (const failure of summary.runFailures.slice(0, 10)) {
      const timestamp = buildHumanReadableDateTime(failure.finishedAt) || failure.finishedAt || "unknown time";
      const description = failure.message || failure.summary || "No failure details recorded";
      html.push(`<li>${timestamp}: ${description}</li>`);
    }
    html.push("</ul>");
  } else {
    html.push('<p style="margin: 12px 0 0; color: #027a48;"><strong>Failed runs:</strong> none</p>');
  }

  if (summary.entities.length > 0) {
    html.push(
      '<h3 style="margin: 16px 0 8px; font-size: 16px;">Recent runs</h3>',
      '<table style="border-collapse: collapse; width: 100%; max-width: 720px;">',
      "<tr>",
      '<th style="text-align: left; border-bottom: 1px solid #d0d5dd; padding: 8px; background: #f8fafc;">Finished</th>',
      '<th style="text-align: left; border-bottom: 1px solid #d0d5dd; padding: 8px; background: #f8fafc;">Status</th>',
      '<th style="text-align: left; border-bottom: 1px solid #d0d5dd; padding: 8px; background: #f8fafc;">Items</th>',
      "</tr>",
    );
    for (const entity of summary.entities.slice(-5)) {
      html.push(
        `<tr><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">${entity.finishedAtDisplay || entity.startedAtDisplay || "unknown"}</td><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">${entity.status}</td><td style="padding: 8px; border-bottom: 1px solid #eaecf0;">success=${entity.successCount}, failed=${entity.failureCount}, skipped=${entity.skippedCount}</td></tr>`,
      );
    }
    html.push("</table>");
  }

  html.push("</section>");
  return { text, html: html.join("") };
}

function buildCombinedSummaryEmailContent({ summaryDate, summaries }) {
  const aggregateTotals = summaries.reduce(
    (totals, summary) => {
      totals.totalRuns += summary.totals.totalRuns;
      totals.successfulRuns += summary.totals.successfulRuns;
      totals.failedRuns += summary.totals.failedRuns;
      totals.successCount += summary.totals.successCount;
      totals.failureCount += summary.totals.failureCount;
      totals.skippedCount += summary.totals.skippedCount;
      return totals;
    },
    {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
    },
  );

  const textSections = [
    `Workflow daily summary bundle`,
    `Date: ${summaryDate}`,
    `Environment: ${getEnvironmentLabel({ BULLHORN_ENV: summaries[0]?.environment || "production" })}`,
    "",
    `Workflows included: ${summaries.length}`,
    `Total runs: ${aggregateTotals.totalRuns}`,
    `Successful runs: ${aggregateTotals.successfulRuns}`,
    `Failed runs: ${aggregateTotals.failedRuns}`,
    `Successful items: ${aggregateTotals.successCount}`,
    `Failed items: ${aggregateTotals.failureCount}`,
    `Skipped items: ${aggregateTotals.skippedCount}`,
  ];

  const htmlSections = [
    '<div style="font-family: Arial, sans-serif; color: #101828; line-height: 1.5; padding: 24px; background: #f8fafc;">',
    '<div style="max-width: 900px; margin: 0 auto; background: #ffffff; border: 1px solid #eaecf0; border-radius: 16px; padding: 24px 28px;">',
    '<h1 style="margin: 0 0 8px; font-size: 28px;">Workflow daily summary bundle</h1>',
    `<p style="margin: 0 0 20px; color: #475467;">Date: <strong>${summaryDate}</strong></p>`,
    `<p style="margin: 0 0 20px; color: #475467;">Environment: <strong>${summaries[0]?.environment || "unknown"}</strong></p>`,
    '<table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">',
    "<tr>",
    '<th style="text-align: left; border-bottom: 1px solid #d0d5dd; padding: 10px; background: #eef2f6;">Metric</th>',
    '<th style="text-align: left; border-bottom: 1px solid #d0d5dd; padding: 10px; background: #eef2f6;">Value</th>',
    "</tr>",
    `<tr><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">Workflows included</td><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">${summaries.length}</td></tr>`,
    `<tr><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">Total runs</td><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">${aggregateTotals.totalRuns}</td></tr>`,
    `<tr><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">Successful runs</td><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">${aggregateTotals.successfulRuns}</td></tr>`,
    `<tr><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">Failed runs</td><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">${aggregateTotals.failedRuns}</td></tr>`,
    `<tr><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">Successful items</td><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">${aggregateTotals.successCount}</td></tr>`,
    `<tr><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">Failed items</td><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">${aggregateTotals.failureCount}</td></tr>`,
    `<tr><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">Skipped items</td><td style="padding: 10px; border-bottom: 1px solid #eaecf0;">${aggregateTotals.skippedCount}</td></tr>`,
    "</table>",
  ];

  for (const summary of summaries) {
    const section = buildSummaryEmailContent(summary);
    textSections.push("", "==================================================", "", section.text);
    htmlSections.push("<hr />", section.html);
  }

  return {
    subject: `[Workflow Summary] Daily bundle - ${summaryDate}`,
    text: textSections.join("\n"),
    html: `${htmlSections.join("")}</div></div>`,
    aggregateTotals,
  };
}

function validateSummaryConfig(config) {
  const missing = [];
  if (!config.AZURE_TABLE_STORAGE_CONNECTION_STRING) {
    missing.push("AZURE_TABLE_STORAGE_CONNECTION_STRING");
  }
  if (!config.DAILY_SUMMARY_RECIPIENT_EMAIL) {
    missing.push("DAILY_SUMMARY_RECIPIENT_EMAIL");
  }
  if (!config.DAILY_SUMMARY_FROM_EMAIL) {
    missing.push("DAILY_SUMMARY_FROM_EMAIL");
  }
  if (!config.SPARKPOST_API_KEY) {
    missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required daily summary config: ${missing.join(", ")}`);
  }
}

async function writeDailySummaryArtifact({ summaryDate, summaries }) {
  return writeJsonArtifact({
    filePrefix: `workflow-daily-summary-${summaryDate}`,
    payload: {
      generatedAt: new Date().toISOString(),
      summaryDate,
      summaries,
    },
  });
}

async function run({ targetDate, workflowName } = {}) {
  const config = loadConfig();
  validateSummaryConfig(config);

  const summaryDate = resolveSummaryDate(targetDate);
  const workflowNames = resolveWorkflowNames(workflowName);
  const sparkPost = new SparkPostClient({ config, logger });
  const summaries = [];

  logger.info(
    {
      summaryDate,
      workflowCount: workflowNames.length,
      workflowName: workflowName || null,
      recipient: config.DAILY_SUMMARY_RECIPIENT_EMAIL,
    },
    "Starting daily workflow summary run",
  );

  for (const currentWorkflowName of workflowNames) {
    const entities = await listWorkflowRunLogsForDate({
      config,
      workflowName: currentWorkflowName,
      runDate: summaryDate,
    });
    const summary = buildWorkflowDailySummary({
      workflowName: currentWorkflowName,
      runDate: summaryDate,
      entities,
    });
    summaries.push({
      ...summary,
    });

    logger.info(
      {
        workflowName: currentWorkflowName,
        summaryDate,
        totalRuns: summary.totals.totalRuns,
        failedRuns: summary.totals.failedRuns,
      },
      "Daily workflow summary collected",
    );
  }

  const combinedEmail = buildCombinedSummaryEmailContent({
    summaryDate,
    summaries,
  });
  const transmission = await sparkPost.sendMessage({
    from: config.DAILY_SUMMARY_FROM_EMAIL,
    to: config.DAILY_SUMMARY_RECIPIENT_EMAIL,
    subject: combinedEmail.subject,
    text: combinedEmail.text,
    html: combinedEmail.html,
  });

  logger.info(
    {
      summaryDate,
      workflowCount: summaries.length,
      totalRuns: combinedEmail.aggregateTotals.totalRuns,
      failedRuns: combinedEmail.aggregateTotals.failedRuns,
    },
    "Daily workflow summary bundle email sent",
  );

  const reportPath = await writeDailySummaryArtifact({
    summaryDate,
    summaries: summaries.map((summary) => ({
      ...summary,
    })),
  });
  logger.info({ reportPath }, "Daily workflow summary report written");

  return {
    summaryDate,
    workflowCount: summaries.length,
    recipientEmail: config.DAILY_SUMMARY_RECIPIENT_EMAIL,
    summaries,
    transmission,
    artifacts: {
      reportPath,
    },
  };
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Daily workflow summary run failed");
    process.exitCode = 1;
  });
}

module.exports = {
  DAILY_SUMMARY_WORKFLOWS,
  buildCombinedSummaryEmailContent,
  buildSummaryEmailContent,
  buildWorkflowDailySummary,
  resolveSummaryDate,
  resolveWorkflowNames,
  run,
};
