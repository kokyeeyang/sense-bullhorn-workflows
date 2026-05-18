const { query } = require("../helpers/postgres");

function toTimestamp(value) {
  return value ? new Date(value) : null;
}

function normalizeLimit(value, defaultLimit = 100, maxLimit = 500) {
  const parsed = Number(value || defaultLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }
  return Math.min(Math.floor(parsed), maxLimit);
}

function mapSurveyResponseRow(row) {
  return {
    partitionKey: row.partition_key || "",
    rowKey: row.row_key || "",
    submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
    workflowName: row.workflow_name || "",
    placementId:
      row.placement_id === null || row.placement_id === undefined ? null : Number(row.placement_id),
    candidateId:
      row.candidate_id === null || row.candidate_id === undefined ? null : Number(row.candidate_id),
    ownerId: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
    ownerEmail: row.owner_email || "",
    recipientEmail: row.recipient_email || "",
    questionId: row.question_id || "",
    questionText: row.question_text || "",
    answer: row.answer || "",
    issuedAt: row.issued_at ? row.issued_at.toISOString() : null,
    surveyKey: row.survey_key || "",
    metadata: row.metadata_json || {},
    userAgent: row.user_agent || "",
    remoteAddress: row.remote_address || "",
    createdAt: row.created_at ? row.created_at.toISOString() : null,
  };
}

async function listWorkflowSurveyResponsesPostgres({
  config,
  dateFrom,
  dateTo,
  workflowName = null,
  surveyKey = null,
  recipientEmail = null,
  answer = null,
  limit = 100,
}) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return [];
  }

  const effectiveDateExpression = "COALESCE(submitted_at::date::text, created_at::date::text)::date";
  const clauses = [
    `${effectiveDateExpression} >= $1::date`,
    `${effectiveDateExpression} <= $2::date`,
  ];
  const values = [
    String(dateFrom).slice(0, 10),
    String(dateTo).slice(0, 10),
  ];

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
  if (surveyKey) {
    addClause("survey_key ILIKE ?", `%${String(surveyKey).trim()}%`);
  }
  if (recipientEmail) {
    addClause("recipient_email ILIKE ?", `%${String(recipientEmail).trim()}%`);
  }
  if (answer) {
    addClause("answer ILIKE ?", `%${String(answer).trim()}%`);
  }

  values.push(normalizeLimit(limit));
  const result = await query({
    config,
    text: `
      SELECT *
      FROM workflow_survey_responses
      WHERE ${clauses.join(" AND ")}
      ORDER BY submitted_at DESC NULLS LAST, created_at DESC
      LIMIT $${values.length}
    `,
    values,
  });

  return result.rows.map(mapSurveyResponseRow);
}

async function upsertWorkflowSurveyTrackingPostgres({ config, tracking }) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return { skipped: true, reason: "postgres-not-configured" };
  }

  await query({
    config,
    text: `
      INSERT INTO workflow_survey_tracking (
        partition_key,
        row_key,
        environment,
        workflow_name,
        survey_key,
        rule_key,
        send_type,
        recipient_type,
        recipient_email,
        recipient_first_name,
        candidate_id,
        candidate_name,
        client_contact_id,
        client_contact_name,
        placement_id,
        client_corporation_id,
        client_corporation_name,
        employment_type,
        current_placement_status,
        business_date,
        initial_sent_at,
        initial_sent_date,
        reminder_due_date,
        reminder_sent_at,
        responded_at,
        response_answer,
        tracking_status,
        token_issued_at,
        context_json,
        metadata_json,
        run_date,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29::jsonb, $30::jsonb,
        $31, NOW()
      )
      ON CONFLICT (partition_key, row_key)
      DO UPDATE SET
        environment = EXCLUDED.environment,
        workflow_name = EXCLUDED.workflow_name,
        survey_key = EXCLUDED.survey_key,
        rule_key = EXCLUDED.rule_key,
        send_type = EXCLUDED.send_type,
        recipient_type = EXCLUDED.recipient_type,
        recipient_email = EXCLUDED.recipient_email,
        recipient_first_name = EXCLUDED.recipient_first_name,
        candidate_id = EXCLUDED.candidate_id,
        candidate_name = EXCLUDED.candidate_name,
        client_contact_id = EXCLUDED.client_contact_id,
        client_contact_name = EXCLUDED.client_contact_name,
        placement_id = EXCLUDED.placement_id,
        client_corporation_id = EXCLUDED.client_corporation_id,
        client_corporation_name = EXCLUDED.client_corporation_name,
        employment_type = EXCLUDED.employment_type,
        current_placement_status = EXCLUDED.current_placement_status,
        business_date = EXCLUDED.business_date,
        initial_sent_at = EXCLUDED.initial_sent_at,
        initial_sent_date = EXCLUDED.initial_sent_date,
        reminder_due_date = EXCLUDED.reminder_due_date,
        reminder_sent_at = EXCLUDED.reminder_sent_at,
        responded_at = EXCLUDED.responded_at,
        response_answer = EXCLUDED.response_answer,
        tracking_status = EXCLUDED.tracking_status,
        token_issued_at = EXCLUDED.token_issued_at,
        context_json = EXCLUDED.context_json,
        metadata_json = EXCLUDED.metadata_json,
        run_date = EXCLUDED.run_date,
        updated_at = NOW()
    `,
    values: [
      tracking.partitionKey,
      tracking.rowKey,
      tracking.environment || "",
      tracking.workflowName || "",
      tracking.surveyKey || "",
      tracking.ruleKey || "",
      tracking.sendType || "initial",
      tracking.recipientType || "",
      tracking.recipientEmail || "",
      tracking.recipientFirstName || "",
      tracking.candidateId ?? null,
      tracking.candidateName || "",
      tracking.clientContactId ?? null,
      tracking.clientContactName || "",
      tracking.placementId ?? null,
      tracking.clientCorporationId ?? null,
      tracking.clientCorporationName || "",
      tracking.employmentType || "",
      tracking.currentPlacementStatus || "",
      tracking.businessDate || "",
      toTimestamp(tracking.initialSentAt),
      tracking.initialSentDate || "",
      tracking.reminderDueDate || "",
      toTimestamp(tracking.reminderSentAt),
      toTimestamp(tracking.respondedAt),
      tracking.responseAnswer || "",
      tracking.trackingStatus || "pending",
      toTimestamp(tracking.tokenIssuedAt),
      JSON.stringify(tracking.context || {}),
      JSON.stringify(tracking.metadata || {}),
      tracking.runDate || tracking.businessDate || tracking.initialSentDate || "",
    ],
  });

  return { skipped: false };
}

async function saveWorkflowSurveyResponsePostgres({ config, response, entity }) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return { skipped: true, reason: "postgres-not-configured" };
  }

  await query({
    config,
    text: `
      INSERT INTO workflow_survey_responses (
        partition_key,
        row_key,
        submitted_at,
        workflow_name,
        placement_id,
        candidate_id,
        owner_id,
        owner_email,
        recipient_email,
        question_id,
        question_text,
        answer,
        issued_at,
        survey_key,
        metadata_json,
        user_agent,
        remote_address
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17
      )
      ON CONFLICT (partition_key, row_key)
      DO UPDATE SET
        submitted_at = EXCLUDED.submitted_at,
        workflow_name = EXCLUDED.workflow_name,
        placement_id = EXCLUDED.placement_id,
        candidate_id = EXCLUDED.candidate_id,
        owner_id = EXCLUDED.owner_id,
        owner_email = EXCLUDED.owner_email,
        recipient_email = EXCLUDED.recipient_email,
        question_id = EXCLUDED.question_id,
        question_text = EXCLUDED.question_text,
        answer = EXCLUDED.answer,
        issued_at = EXCLUDED.issued_at,
        survey_key = EXCLUDED.survey_key,
        metadata_json = EXCLUDED.metadata_json,
        user_agent = EXCLUDED.user_agent,
        remote_address = EXCLUDED.remote_address
    `,
    values: [
      entity.partitionKey,
      entity.rowKey,
      toTimestamp(entity.submittedAt),
      response.workflowName || "",
      response.placementId ?? null,
      response.candidateId ?? null,
      response.ownerId ?? null,
      entity.ownerEmail || "",
      entity.recipientEmail || "",
      entity.questionId || "",
      entity.questionText || "",
      entity.answer || "",
      toTimestamp(entity.issuedAt),
      entity.surveyKey || "",
      entity.metadataJson || "{}",
      entity.userAgent || "",
      entity.remoteAddress || "",
    ],
  });

  return { skipped: false };
}

module.exports = {
  listWorkflowSurveyResponsesPostgres,
  saveWorkflowSurveyResponsePostgres,
  upsertWorkflowSurveyTrackingPostgres,
};
