const { query } = require("../helpers/postgres");
const {
  buildWorkflowDataMutationAuditRecords,
} = require("../utils/workflowDataMutationAuditRecords");

function getEnvironmentLabel(config) {
  return String(config.BULLHORN_ENV || "production").trim().toLowerCase();
}

function buildRunDate(value) {
  return String(value || new Date().toISOString()).slice(0, 10);
}

async function writeWorkflowDataMutationAuditRecordsPostgres({ config, logger, records }) {
  if (!config.POSTGRES_CONNECTION_STRING || !Array.isArray(records) || records.length === 0) {
    return { skipped: true, count: 0, reason: "postgres-not-configured-or-no-records" };
  }

  const environment = getEnvironmentLabel(config);

  for (const record of records) {
    await query({
      config,
      text: `
        INSERT INTO workflow_data_mutation_audit (
          environment,
          workflow_name,
          run_date,
          generated_at,
          dry_run,
          action,
          entity_type,
          entity_id,
          related_entity_type,
          related_entity_id,
          candidate_id,
          placement_id,
          client_contact_id,
          client_corporation_id,
          transaction_id,
          field_name,
          old_value_text,
          new_value_text,
          old_value_json,
          new_value_json,
          reason,
          details_json
        )
        VALUES (
          $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21, $22::jsonb
        )
      `,
      values: [
        environment,
        record.workflowName || "",
        buildRunDate(record.generatedAt),
        record.generatedAt ? new Date(record.generatedAt) : null,
        Boolean(record.dryRun),
        record.action || "",
        record.entityType || "",
        record.entityId ?? null,
        record.relatedEntityType || "",
        record.relatedEntityId ?? null,
        record.candidateId ?? null,
        record.placementId ?? null,
        record.clientContactId ?? null,
        record.clientCorporationId ?? null,
        record.transactionId || "",
        record.fieldName || "",
        record.oldValueText ?? null,
        record.newValueText ?? null,
        JSON.stringify(record.oldValue ?? null),
        JSON.stringify(record.newValue ?? null),
        record.reason || "",
        JSON.stringify(record.details || {}),
      ],
    });
  }

  logger.info(
    {
      recordCount: records.length,
    },
    "Workflow data mutation audit records written to PostgreSQL",
  );

  return { skipped: false, count: records.length };
}

async function writeWorkflowDataMutationAuditRecordsSafe({
  config,
  logger,
  workflowName,
  report,
}) {
  const records = buildWorkflowDataMutationAuditRecords({ workflowName, report });

  try {
    return await writeWorkflowDataMutationAuditRecordsPostgres({ config, logger, records });
  } catch (error) {
    logger.warn(
      {
        workflowName,
        recordCount: records.length,
        error: {
          message: error.message,
          stack: error.stack,
        },
      },
      "Failed to write workflow data mutation audit records to PostgreSQL",
    );

    return { skipped: true, count: 0, reason: "postgres-write-failed" };
  }
}

module.exports = {
  writeWorkflowDataMutationAuditRecordsPostgres,
  writeWorkflowDataMutationAuditRecordsSafe,
};
