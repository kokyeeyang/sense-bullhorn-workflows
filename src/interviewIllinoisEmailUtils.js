const {
  buildFullName,
  normalizeString,
} = require("./placementStartReminderUtils");

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function formatBullhornDateToIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function parseIsoDateToUtcMs(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getTime();
}

function isInterviewAppointment(appointment) {
  return normalizeLower(appointment?.type) === "interview";
}

function matchesOptionalStringFilter(actualValue, expectedValue) {
  const normalizedExpected = normalizeString(expectedValue);
  if (!normalizedExpected) {
    return true;
  }

  return normalizeLower(actualValue) === normalizeLower(normalizedExpected);
}

function matchesOptionalDateFilter(actualValue, expectedValue) {
  const normalizedExpected = normalizeString(expectedValue);
  if (!normalizedExpected) {
    return true;
  }

  const actualDate = new Date(actualValue);
  if (Number.isNaN(actualDate.getTime())) {
    return false;
  }

  const expectedDateMs = parseIsoDateToUtcMs(normalizedExpected);
  if (expectedDateMs === null) {
    return false;
  }

  return actualDate.getTime() >= expectedDateMs;
}

function matchesIllinoisInterviewJobOrder({ appointment, config }) {
  const matchDetails = getIllinoisInterviewJobOrderMatchDetails({ appointment, config });

  return matchDetails.matches;
}

function getIllinoisInterviewJobOrderMatchDetails({ appointment, config }) {
  const jobOrder = appointment?.jobOrder || {};
  const stateMatches = matchesOptionalStringFilter(
    jobOrder?.address?.state,
    config.INTERVIEW_ILLINOIS_JOB_ORDER_STATE,
  );
  const dateAddedMatches = matchesOptionalDateFilter(
    jobOrder?.dateAdded,
    config.INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED,
  );
  const employmentTypeMatches = matchesOptionalStringFilter(
    jobOrder?.employmentType,
    config.INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE,
  );

  return {
    matches: stateMatches && dateAddedMatches && employmentTypeMatches,
    stateMatches,
    dateAddedMatches,
    employmentTypeMatches,
    actual: {
      state: jobOrder?.address?.state ?? null,
      dateAdded: jobOrder?.dateAdded ?? null,
      employmentType: jobOrder?.employmentType ?? null,
    },
    expected: {
      state: config.INTERVIEW_ILLINOIS_JOB_ORDER_STATE || null,
      dateAdded: config.INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED || null,
      employmentType: config.INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE || null,
    },
  };
}

function buildInterviewIllinoisRecipient({ appointment, owner, recipientEmail }) {
  return {
    address: {
      email: recipientEmail,
    },
    substitution_data: {
      id: normalizeString(appointment?.id),
      candidateReference: {
        name:
          normalizeString(appointment?.candidateReference?.name) ||
          buildFullName(appointment?.candidateReference),
        id: normalizeString(appointment?.candidateReference?.id),
      },
    },
  };
}

module.exports = {
  buildInterviewIllinoisRecipient,
  formatBullhornDateToIsoDate,
  getIllinoisInterviewJobOrderMatchDetails,
  isInterviewAppointment,
  matchesOptionalDateFilter,
  matchesOptionalStringFilter,
  matchesIllinoisInterviewJobOrder,
  parseIsoDateToUtcMs,
};
