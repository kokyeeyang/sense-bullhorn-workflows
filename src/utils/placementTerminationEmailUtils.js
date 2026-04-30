const {
  buildFullName,
  formatDateBegin,
  normalizeString,
} = require("./placementStartReminderUtils");

function normalizeStatus(value) {
  return normalizeString(value).toLowerCase();
}

function isTerminatedPlacementStatusChange(statusChange) {
  if (!statusChange) return false;

  return normalizeStatus(statusChange.newValue) === "terminated";
}

function buildPlacementTerminationRecipient({ placement, owner, recipientEmail }) {
  return {
    address: {
      email: recipientEmail,
    },
    substitution_data: {
      owner_firstName: normalizeString(owner?.firstName),
      placement_id: normalizeString(placement?.id),
      placement_status: normalizeString(placement?.status),
      candidate_name: buildFullName(placement?.candidate),
      candidate_email: normalizeString(placement?.candidate?.email),
      client_company_name: normalizeString(placement?.clientCorporation?.name),
      job_title: normalizeString(placement?.jobOrder?.title),
      date_begin: formatDateBegin(placement?.dateBegin),
      date_end: formatDateBegin(placement?.dateEnd),
    },
  };
}

module.exports = {
  buildPlacementTerminationRecipient,
  isTerminatedPlacementStatusChange,
};
