const { query } = require("../helpers/postgres");

function getEnvironmentLabel(config) {
  return String(config.BULLHORN_ENV || "production").trim().toLowerCase();
}

function buildRunDate(value) {
  return String(value).slice(0, 10);
}

function buildHumanReadableDateTime(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

function normalizeArtifactPathForStorage(artifactPath) {
  if (!artifactPath) {
    return "";
  }

  const normalized = String(artifactPath).replace(/\\/g, "/");
  const reportsIndex = normalized.lastIndexOf("/reports/");
  if (reportsIndex >= 0) {
    return `/tmp${normalized.slice(reportsIndex)}`;
  }

  return `/tmp/reports/${normalized.split("/").pop()}`;
}

function toTimestamp(value) {
  return value ? new Date(value) : null;
}

function mapRunLogRow(row) {
  return {
    environment: row.environment,
    workflowName: row.workflow_name,
    runDate: row.run_date instanceof Date ? row.run_date.toISOString().slice(0, 10) : row.run_date,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    startedAtDisplay: row.started_at_display || "",
    finishedAtDisplay: row.finished_at_display || "",
    successCount: Number(row.success_count || 0),
    failureCount: Number(row.failure_count || 0),
    skippedCount: Number(row.skipped_count || 0),
    summary: row.summary || "",
    detailsJson: JSON.stringify(row.details_json || {}),
    artifactPath: row.artifact_path || "",
    emailedInDailySummary: Boolean(row.emailed_in_daily_summary),
  };
}

async function writeWorkflowRunLogPostgres({
  config,
  logger,
  workflowName,
  trigger,
  startedAt,
  finishedAt,
  status,
  summary,
}) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return { skipped: true, reason: "postgres-not-configured" };
  }

  const environment = getEnvironmentLabel(config);
  const runDate = buildRunDate(finishedAt);

  await query({
    config,
    text: `
      INSERT INTO workflow_run_logs (
        environment,
        workflow_name,
        run_date,
        trigger,
        status,
        started_at,
        finished_at,
        started_at_display,
        finished_at_display,
        success_count,
        failure_count,
        skipped_count,
        summary,
        details_json,
        artifact_path,
        emailed_in_daily_summary
      )
      VALUES (
        $1, $2, $3::date, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14::jsonb, $15, false
      )
    `,
    values: [
      environment,
      workflowName,
      runDate,
      trigger,
      status,
      toTimestamp(startedAt),
      toTimestamp(finishedAt),
      buildHumanReadableDateTime(startedAt) || "",
      buildHumanReadableDateTime(finishedAt) || "",
      Number(summary.successCount || 0),
      Number(summary.failureCount || 0),
      Number(summary.skippedCount || 0),
      summary.summary || "",
      JSON.stringify(summary.details || {}),
      normalizeArtifactPathForStorage(summary.artifactPath),
    ],
  });

  logger.info(
    {
      environment,
      workflowName,
      runDate,
    },
    "Workflow run log written to PostgreSQL",
  );

  return { skipped: false, runDate };
}

async function listWorkflowRunLogsForDatePostgres({ config, workflowName, runDate }) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return [];
  }

  const environment = getEnvironmentLabel(config);
  const result = await query({
    config,
    text: `
      SELECT *
      FROM workflow_run_logs
      WHERE environment = $1
        AND workflow_name = $2
        AND run_date = $3::date
      ORDER BY finished_at ASC NULLS LAST, id ASC
    `,
    values: [environment, workflowName, buildRunDate(runDate)],
  });

  return result.rows.map(mapRunLogRow);
}

module.exports = {
  listWorkflowRunLogsForDatePostgres,
  writeWorkflowRunLogPostgres,
};
