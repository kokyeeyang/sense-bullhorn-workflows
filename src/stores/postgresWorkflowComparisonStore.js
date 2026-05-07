const { query } = require("../helpers/postgres");

function getEnvironmentLabel(config) {
  return String(config.BULLHORN_ENV || "production").trim().toLowerCase();
}

function buildRunDate(value) {
  return String(value).slice(0, 10);
}

async function writeWorkflowComparisonRecordsPostgres({ config, logger, records }) {
  if (!config.POSTGRES_CONNECTION_STRING || !Array.isArray(records) || records.length === 0) {
    return { skipped: true, count: 0, reason: "postgres-not-configured-or-no-records" };
  }

  const environment = getEnvironmentLabel(config);

  for (const record of records) {
    await query({
      config,
      text: `
        INSERT INTO workflow_comparison_records (
          environment,
          workflow_name,
          run_date,
          generated_at,
          source_system,
          record_type,
          action_decision,
          entity_type,
          entity_id,
          transaction_id,
          candidate_id,
          related_id,
          details_json
        )
        VALUES (
          $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
        )
      `,
      values: [
        environment,
        record.workflowName || "",
        buildRunDate(record.generatedAt || new Date().toISOString()),
        record.generatedAt ? new Date(record.generatedAt) : null,
        record.sourceSystem || "azure-functions",
        record.recordType || "",
        record.actionDecision || "",
        record.entityType || "",
        record.entityId ?? null,
        record.transactionId || "",
        record.candidateId ?? null,
        record.relatedId ?? null,
        JSON.stringify(record.details || {}),
      ],
    });
  }

  logger.info(
    {
      recordCount: records.length,
    },
    "Workflow comparison records written to PostgreSQL",
  );

  return { skipped: false, count: records.length };
}

module.exports = {
  writeWorkflowComparisonRecordsPostgres,
};
