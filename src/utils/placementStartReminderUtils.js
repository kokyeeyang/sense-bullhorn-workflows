function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function buildFullName(person) {
  return [person?.firstName, person?.lastName]
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(" ");
}

function buildFullAddress(address) {
  return [
    address?.address1,
    address?.address2,
    address?.city,
    address?.state,
    address?.zip,
    address?.countryName,
  ]
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(", ");
}

function formatDateBegin(dateBegin) {
  const date = new Date(dateBegin);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function buildSparkPostRecipient({ placement, recipientEmail }) {
  return {
    address: {
      email: recipientEmail,
    },
    substitution_data: {
      placement_id: normalizeString(placement?.id),
      jobOrderOwner_firstName: normalizeString(placement?.jobOrder?.owner?.firstName),
      candidate_name: buildFullName(placement?.candidate),
      client_company_name: normalizeString(placement?.clientCorporation?.name),
      date_begin: formatDateBegin(placement?.dateBegin),
      so_entity: normalizeString(placement?.customText60),
      legal_entity_name: normalizeString(placement?.clientCorporation?.customText11),
      billingClientContact_country_name: normalizeString(
        placement?.billingClientContact?.address?.countryName,
      ),
      tob_agreed: normalizeString(placement?.clientCorporation?.customText2),
      po_required: normalizeString(placement?.customText8),
      po_number: normalizeString(placement?.customText18),
      finance_ref_number: normalizeString(placement?.billingClientContact?.customText3),
      billingClientContact_name: buildFullName(placement?.billingClientContact),
      billingClientContact_full_address: buildFullAddress(
        placement?.billingClientContact?.address,
      ),
    },
  };
}

module.exports = {
  buildFullAddress,
  buildFullName,
  buildSparkPostRecipient,
  formatDateBegin,
  normalizeString,
};
