const { query } = require("../helpers/postgres");

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function toTimestamp(value) {
  return value ? new Date(value) : null;
}

function extractRecipientEmail(recipients = []) {
  for (const recipient of recipients) {
    const email = recipient?.address?.email;
    if (email) {
      return normalizeString(email).toLowerCase();
    }
  }

  return "";
}

function extractProviderTransmissionId(providerResponse) {
  return normalizeString(
    providerResponse?.results?.id ||
      providerResponse?.results?.transmission_id ||
      providerResponse?.transmission_id,
  );
}

function extractProviderMessageId(providerResponse) {
  const firstMessage =
    providerResponse?.results?.rcpt_to_errors?.[0]?.message_id ||
    providerResponse?.results?.message_id ||
    providerResponse?.message_id;

  return normalizeString(firstMessage);
}

function mapEmailTransmissionRow(row) {
  return {
    id: Number(row.id || 0),
    environment: row.environment || "",
    workflowName: row.workflow_name || "",
    provider: row.provider || "",
    sendMethod: row.send_method || "",
    sendType: row.send_type || "",
    ruleKey: row.rule_key || "",
    recipientType: row.recipient_type || "",
    recipientEmail: row.recipient_email || "",
    recipientFirstName: row.recipient_first_name || "",
    fromEmail: row.from_email || "",
    fromName: row.from_name || "",
    subject: row.subject || "",
    templateId: row.template_id || "",
    providerTransmissionId: row.provider_transmission_id || "",
    providerMessageId: row.provider_message_id || "",
    placementId:
      row.placement_id === null || row.placement_id === undefined ? null : Number(row.placement_id),
    candidateId:
      row.candidate_id === null || row.candidate_id === undefined ? null : Number(row.candidate_id),
    clientContactId:
      row.client_contact_id === null || row.client_contact_id === undefined
        ? null
        : Number(row.client_contact_id),
    clientCorporationId:
      row.client_corporation_id === null || row.client_corporation_id === undefined
        ? null
        : Number(row.client_corporation_id),
    ownerId: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
    ownerEmail: row.owner_email || "",
    surveyKey: row.survey_key || "",
    businessDate: row.business_date || "",
    runDate: row.run_date || row.effective_run_date || "",
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    textBody: row.text_body || "",
    htmlBody: row.html_body || "",
    transmissionPayload: row.transmission_payload_json || {},
    providerResponse: row.provider_response_json || {},
    context: row.context_json || {},
    metadata: row.metadata_json || {},
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

function getEnvironmentLabel(config) {
  return String(config.BULLHORN_ENV || "production").trim().toLowerCase();
}

async function listWorkflowEmailTransmissionsPostgres({
  config,
  dateFrom,
  dateTo,
  workflowName = null,
  sendType = null,
  recipientEmail = null,
  fromEmail = null,
  subject = null,
  limit = 100,
}) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return [];
  }

  const effectiveDateExpression =
    "COALESCE(NULLIF(run_date, ''), sent_at::date::text, created_at::date::text)::date";
  const clauses = [
    "environment = $1",
    `${effectiveDateExpression} >= $2::date`,
    `${effectiveDateExpression} <= $3::date`,
  ];
  const values = [
    getEnvironmentLabel(config),
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
  if (sendType) {
    addClause("send_type = ?", String(sendType).trim());
  }
  if (recipientEmail) {
    addClause("recipient_email ILIKE ?", `%${String(recipientEmail).trim()}%`);
  }
  if (fromEmail) {
    addClause("from_email ILIKE ?", `%${String(fromEmail).trim()}%`);
  }
  if (subject) {
    addClause("subject ILIKE ?", `%${String(subject).trim()}%`);
  }

  values.push(normalizeLimit(limit));
  const result = await query({
    config,
    text: `
      SELECT *,
        ${effectiveDateExpression}::text AS effective_run_date
      FROM workflow_email_transmissions
      WHERE ${clauses.join(" AND ")}
      ORDER BY sent_at DESC NULLS LAST, id DESC
      LIMIT $${values.length}
    `,
    values,
  });

  return result.rows.map(mapEmailTransmissionRow);
}

async function insertWorkflowEmailTransmissionPostgres({ config, transmission }) {
  if (!config.POSTGRES_CONNECTION_STRING) {
    return { skipped: true, reason: "postgres-not-configured" };
  }

  const payload = transmission.payload || {};
  const content = payload.content || {};
  const tracking = transmission.tracking || {};
  const audit = transmission.audit || {};
  const recipientEmail =
    normalizeString(audit.recipientEmail).toLowerCase() ||
    normalizeString(tracking.recipientEmail).toLowerCase() ||
    extractRecipientEmail(payload.recipients);

  await query({
    config,
    text: `
      INSERT INTO workflow_email_transmissions (
        environment,
        workflow_name,
        provider,
        send_method,
        send_type,
        rule_key,
        recipient_type,
        recipient_email,
        recipient_first_name,
        from_email,
        from_name,
        subject,
        template_id,
        provider_transmission_id,
        provider_message_id,
        placement_id,
        candidate_id,
        client_contact_id,
        client_corporation_id,
        owner_id,
        owner_email,
        survey_key,
        business_date,
        run_date,
        sent_at,
        text_body,
        html_body,
        transmission_payload_json,
        provider_response_json,
        context_json,
        metadata_json
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28::jsonb, $29::jsonb, $30::jsonb, $31::jsonb
      )
    `,
    values: [
      normalizeString(transmission.environment),
      normalizeString(audit.workflowName),
      normalizeString(transmission.provider || "sparkpost"),
      normalizeString(transmission.sendMethod),
      normalizeString(audit.sendType || tracking.sendType),
      normalizeString(audit.ruleKey || tracking.ruleKey),
      normalizeString(audit.recipientType || tracking.recipientType),
      recipientEmail,
      normalizeString(audit.recipientFirstName || tracking.recipientFirstName),
      normalizeString(content?.from?.email),
      normalizeString(content?.from?.name),
      normalizeString(content?.subject),
      normalizeString(content?.template_id),
      extractProviderTransmissionId(transmission.providerResponse),
      extractProviderMessageId(transmission.providerResponse),
      audit.placementId ?? null,
      audit.candidateId ?? null,
      audit.clientContactId ?? null,
      audit.clientCorporationId ?? null,
      audit.ownerId ?? null,
      normalizeString(audit.ownerEmail),
      normalizeString(audit.surveyKey || tracking.surveyKey),
      normalizeString(audit.businessDate),
      normalizeString(audit.runDate || audit.businessDate),
      toTimestamp(transmission.sentAt),
      normalizeString(content?.text),
      normalizeString(content?.html),
      JSON.stringify(payload),
      JSON.stringify(transmission.providerResponse || {}),
      JSON.stringify(audit.context || {}),
      JSON.stringify(audit.metadata || {}),
    ],
  });

  return { skipped: false };
}

module.exports = {
  insertWorkflowEmailTransmissionPostgres,
  listWorkflowEmailTransmissionsPostgres,
};
