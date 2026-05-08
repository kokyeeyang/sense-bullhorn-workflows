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
};
