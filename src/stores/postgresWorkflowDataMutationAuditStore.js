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

function mapMutationAuditRow(row) {
  return {
    id: Number(row.id || 0),
    environment: row.environment || "",
    workflowName: row.workflow_name || "",
    runDate: row.run_date instanceof Date ? row.run_date.toISOString().slice(0, 10) : row.run_date,
    generatedAt: row.generated_at ? row.generated_at.toISOString() : null,
    dryRun: Boolean(row.dry_run),
    action: row.action || "",
    entityType: row.entity_type || "",
    entityId: row.entity_id === null || row.entity_id === undefined ? null : Number(row.entity_id),
    relatedEntityType: row.related_entity_type || "",
    relatedEntityId:
      row.related_entity_id === null || row.related_entity_id === undefined
        ? null
        : Number(row.related_entity_id),
    candidateId:
      row.candidate_id === null || row.candidate_id === undefined ? null : Number(row.candidate_id),
    placementId:
      row.placement_id === null || row.placement_id === undefined ? null : Number(row.placement_id),
    clientContactId:
      row.client_contact_id === null || row.client_contact_id === undefined
        ? null
        : Number(row.client_contact_id),
    clientCorporationId:
      row.client_corporation_id === null || row.client_corporation_id === undefined
        ? null
        : Number(row.client_corporation_id),
    transactionId: row.transaction_id || "",
    fieldName: row.field_name || "",
    oldValueText: row.old_value_text,
    newValueText: row.new_value_text,
    oldValue: row.old_value_json,
    newValue: row.new_value_json,
    reason: row.reason || "",
    details: row.details_json || {},
    createdAt: row.created_at ? row.created_at.toISOString() : null,
  };
}

function normalizeLimit(value, defaultLimit = 100, maxLimit = 500) {
  const parsed = Number(value || defaultLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }
  return Math.min(Math.floor(parsed), maxLimit);
}

async function listWorkflowDataMutationAuditRecordsPostgres({
  config,
  dateFrom,
  dateTo,
  workflowName = null,
  action = null,
  entityType = null,
  fieldName = null,
  candidateId = null,
  entityId = null,
  limit = 100,
}) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return [];
  }

  const environment = getEnvironmentLabel(config);
  const clauses = [
    "environment = $1",
    "run_date >= $2::date",
    "run_date <= $3::date",
  ];
  const values = [environment, buildRunDate(dateFrom), buildRunDate(dateTo)];

  function addClause(sql, value) {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  }

  if (workflowName) {
    const workflowNames = String(workflowName)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (workflowNames.length > 0) {
      addClause("workflow_name = ANY(?::text[])", workflowNames);
    }
  }
  if (action) {
    addClause("action = ?", String(action).trim());
  }
  if (entityType) {
    addClause("entity_type = ?", String(entityType).trim());
  }
  if (fieldName) {
    addClause("field_name = ?", String(fieldName).trim());
  }
  if (candidateId) {
    addClause("candidate_id = ?::bigint", Number(candidateId));
  }
  if (entityId) {
    addClause("entity_id = ?::bigint", Number(entityId));
  }

  values.push(normalizeLimit(limit));
  const result = await query({
    config,
    text: `
      SELECT *
      FROM workflow_data_mutation_audit
      WHERE ${clauses.join(" AND ")}
      ORDER BY generated_at DESC NULLS LAST, id DESC
      LIMIT $${values.length}
    `,
    values,
  });

  return result.rows.map(mapMutationAuditRow);
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
  listWorkflowDataMutationAuditRecordsPostgres,
  writeWorkflowDataMutationAuditRecordsPostgres,
  writeWorkflowDataMutationAuditRecordsSafe,
};
