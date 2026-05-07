const { query } = require("../helpers/postgres");

function toTimestamp(value) {
  return value ? new Date(value) : null;
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
  saveWorkflowSurveyResponsePostgres,
  upsertWorkflowSurveyTrackingPostgres,
};
