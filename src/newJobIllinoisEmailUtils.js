const { normalizeString } = require("./placementStartReminderUtils");

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function buildUtcAgeWindow({
  baseDate = new Date(),
  graceHours = 24,
  intervalHours = 24,
} = {}) {
  const nowMs = baseDate.getTime();

  return {
    startMs: nowMs - (graceHours + intervalHours) * 60 * 60 * 1000,
    endMs: nowMs - graceHours * 60 * 60 * 1000,
    graceHours,
    intervalHours,
  };
}

function matchesNewJobIllinoisJobOrder({ jobOrder, config }) {
  return (
    normalizeLower(jobOrder?.address?.state) ===
      normalizeLower(config.NEW_JOB_ILLINOIS_JOB_ORDER_STATE) &&
    normalizeLower(jobOrder?.employmentType) ===
      normalizeLower(config.NEW_JOB_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE)
  );
}

function buildNewJobIllinoisRecipient({ jobOrder, owner, recipientEmail }) {
  return {
    address: {
      email: recipientEmail,
    },
    substitution_data: {
      id: normalizeString(jobOrder?.id),
      job_order_id: normalizeString(jobOrder?.id),
      client_corporation_name: normalizeString(jobOrder?.clientCorporation?.name),
      job_order_date_added: jobOrder?.dateAdded || null,
      job_order_employment_type: normalizeString(jobOrder?.employmentType),
      job_order_state: normalizeString(jobOrder?.address?.state),
      owner_id: normalizeString(owner?.id),
      owner_first_name: normalizeString(owner?.firstName),
      owner_last_name: normalizeString(owner?.lastName),
      owner_email: normalizeString(recipientEmail),
    },
  };
}

module.exports = {
  buildNewJobIllinoisRecipient,
  buildUtcAgeWindow,
  matchesNewJobIllinoisJobOrder,
  normalizeLower,
};
