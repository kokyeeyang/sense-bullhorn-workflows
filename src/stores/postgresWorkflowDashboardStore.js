const { query } = require("../helpers/postgres");

function getEnvironmentLabel(config) {
  return String(config.BULLHORN_ENV || "production").trim().toLowerCase();
}

function mapMetricRow(row) {
  return {
    environment: row.environment || null,
    workflowName: row.workflow_name || null,
    runDate: row.run_date instanceof Date ? row.run_date.toISOString().slice(0, 10) : row.run_date,
    monthKey: row.month_key || null,
    totalRuns: Number(row.total_runs || 0),
    successfulRuns: Number(row.successful_runs || 0),
    failedRuns: Number(row.failed_runs || 0),
    successCount: Number(row.success_count || 0),
    failureCount: Number(row.failure_count || 0),
    skippedCount: Number(row.skipped_count || 0),
    comparisonRecordCount: Number(row.comparison_record_count || 0),
    updatedCount: Number(row.updated_count || 0),
    wouldUpdateCount: Number(row.would_update_count || 0),
    sentEmailCount: Number(row.sent_email_count || 0),
    wouldSendEmailCount: Number(row.would_send_email_count || 0),
    totalEmailCount: Number(row.total_email_count || 0),
    skippedActionCount: Number(row.skipped_action_count || 0),
    fieldChangeCount: Number(row.field_change_count || 0),
    actionDecisionCounts: row.action_decision_counts_json || {},
    recordTypeCounts: row.record_type_counts_json || {},
    entityTypeCounts: row.entity_type_counts_json || {},
    fieldCounts: row.field_counts_json || {},
    stageCounts: row.stage_counts_json || {},
    skipReasonCounts: row.skip_reason_counts_json || {},
    firstRunAt: row.first_run_at ? row.first_run_at.toISOString() : null,
    lastRunAt: row.last_run_at ? row.last_run_at.toISOString() : null,
    lastRunAtDisplay: row.last_run_at_display || null,
    lastRunStatus: row.last_run_status || null,
    lastSummary: row.last_summary || null,
    artifactPath: row.artifact_path || null,
    lastUpdatedAt: row.last_updated_at ? row.last_updated_at.toISOString() : null,
  };
}

function buildUpsertValues({ environment, metrics }) {
  return [
    environment,
    metrics.workflowName,
    metrics.runDate,
    metrics.monthKey,
    metrics.totalRuns,
    metrics.successfulRuns,
    metrics.failedRuns,
    metrics.successCount,
    metrics.failureCount,
    metrics.skippedCount,
    metrics.comparisonRecordCount,
    metrics.updatedCount,
    metrics.wouldUpdateCount,
    metrics.sentEmailCount,
    metrics.wouldSendEmailCount,
    metrics.totalEmailCount,
    metrics.skippedActionCount,
    metrics.fieldChangeCount,
    JSON.stringify(metrics.actionDecisionCounts || {}),
    JSON.stringify(metrics.recordTypeCounts || {}),
    JSON.stringify(metrics.entityTypeCounts || {}),
    JSON.stringify(metrics.fieldCounts || {}),
    JSON.stringify(metrics.stageCounts || {}),
    JSON.stringify(metrics.skipReasonCounts || {}),
    metrics.firstRunAt ? new Date(metrics.firstRunAt) : null,
    metrics.lastRunAt ? new Date(metrics.lastRunAt) : null,
    metrics.lastRunAtDisplay || "",
    metrics.lastRunStatus || "",
    metrics.lastSummary || "",
    metrics.artifactPath || "",
    metrics.lastUpdatedAt ? new Date(metrics.lastUpdatedAt) : new Date(),
  ];
}

async function upsertWorkflowDashboardMetricsPostgres({ config, logger, byDayMetrics, byWorkflowMetrics }) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return { skipped: true, reason: "postgres-not-configured" };
  }

  const environment = getEnvironmentLabel(config);
  const insertSql = (tableName, conflictColumns) => `
    INSERT INTO ${tableName} (
      environment,
      workflow_name,
      run_date,
      month_key,
      total_runs,
      successful_runs,
      failed_runs,
      success_count,
      failure_count,
      skipped_count,
      comparison_record_count,
      updated_count,
      would_update_count,
      sent_email_count,
      would_send_email_count,
      total_email_count,
      skipped_action_count,
      field_change_count,
      action_decision_counts_json,
      record_type_counts_json,
      entity_type_counts_json,
      field_counts_json,
      stage_counts_json,
      skip_reason_counts_json,
      first_run_at,
      last_run_at,
      last_run_at_display,
      last_run_status,
      last_summary,
      artifact_path,
      last_updated_at
    )
    VALUES (
      $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18,
      $19::jsonb, $20::jsonb, $21::jsonb, $22::jsonb, $23::jsonb, $24::jsonb,
      $25, $26, $27, $28, $29, $30, $31
    )
    ON CONFLICT (${conflictColumns})
    DO UPDATE SET
      month_key = EXCLUDED.month_key,
      total_runs = EXCLUDED.total_runs,
      successful_runs = EXCLUDED.successful_runs,
      failed_runs = EXCLUDED.failed_runs,
      success_count = EXCLUDED.success_count,
      failure_count = EXCLUDED.failure_count,
      skipped_count = EXCLUDED.skipped_count,
      comparison_record_count = EXCLUDED.comparison_record_count,
      updated_count = EXCLUDED.updated_count,
      would_update_count = EXCLUDED.would_update_count,
      sent_email_count = EXCLUDED.sent_email_count,
      would_send_email_count = EXCLUDED.would_send_email_count,
      total_email_count = EXCLUDED.total_email_count,
      skipped_action_count = EXCLUDED.skipped_action_count,
      field_change_count = EXCLUDED.field_change_count,
      action_decision_counts_json = EXCLUDED.action_decision_counts_json,
      record_type_counts_json = EXCLUDED.record_type_counts_json,
      entity_type_counts_json = EXCLUDED.entity_type_counts_json,
      field_counts_json = EXCLUDED.field_counts_json,
      stage_counts_json = EXCLUDED.stage_counts_json,
      skip_reason_counts_json = EXCLUDED.skip_reason_counts_json,
      first_run_at = EXCLUDED.first_run_at,
      last_run_at = EXCLUDED.last_run_at,
      last_run_at_display = EXCLUDED.last_run_at_display,
      last_run_status = EXCLUDED.last_run_status,
      last_summary = EXCLUDED.last_summary,
      artifact_path = EXCLUDED.artifact_path,
      last_updated_at = EXCLUDED.last_updated_at
  `;

  await query({
    config,
    text: insertSql("workflow_dashboard_metrics_daily", "environment, run_date, workflow_name"),
    values: buildUpsertValues({ environment, metrics: byDayMetrics }),
  });

  await query({
    config,
    text: insertSql(
      "workflow_dashboard_metrics_by_workflow",
      "environment, workflow_name, run_date",
    ),
    values: buildUpsertValues({ environment, metrics: byWorkflowMetrics }),
  });

  logger.info(
    {
      workflowName: byDayMetrics.workflowName,
      runDate: byDayMetrics.runDate,
    },
    "Workflow dashboard metrics written to PostgreSQL",
  );

  return { skipped: false, runDate: byDayMetrics.runDate };
}

async function listWorkflowDashboardMetricsByDateRangePostgres({
  config,
  dateFrom,
  dateTo,
  workflowName = null,
}) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return [];
  }

  const environment = getEnvironmentLabel(config);
  const workflowNames = workflowName
    ? String(workflowName)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const values = [environment, String(dateFrom).slice(0, 10), String(dateTo).slice(0, 10)];
  let workflowClause = "";
  if (workflowNames.length > 0) {
    workflowClause = ` AND workflow_name = ANY($4::text[])`;
    values.push(workflowNames);
  }

  const result = await query({
    config,
    text: `
      SELECT *
      FROM workflow_dashboard_metrics_daily
      WHERE environment = $1
        AND run_date >= $2::date
        AND run_date <= $3::date
        ${workflowClause}
      ORDER BY run_date ASC, workflow_name ASC
    `,
    values,
  });

  return result.rows.map(mapMetricRow);
}

async function listWorkflowDashboardMetricsByWorkflowRangePostgres({
  config,
  workflowName,
  dateFrom,
  dateTo,
}) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return [];
  }

  const environment = getEnvironmentLabel(config);
  const result = await query({
    config,
    text: `
      SELECT *
      FROM workflow_dashboard_metrics_by_workflow
      WHERE environment = $1
        AND workflow_name = $2
        AND run_date >= $3::date
        AND run_date <= $4::date
      ORDER BY run_date ASC
    `,
    values: [environment, workflowName, String(dateFrom).slice(0, 10), String(dateTo).slice(0, 10)],
  });

  return result.rows.map(mapMetricRow);
}

module.exports = {
  listWorkflowDashboardMetricsByDateRangePostgres,
  listWorkflowDashboardMetricsByWorkflowRangePostgres,
  upsertWorkflowDashboardMetricsPostgres,
};
