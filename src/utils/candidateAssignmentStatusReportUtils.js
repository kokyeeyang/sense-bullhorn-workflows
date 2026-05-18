const { buildFullName, normalizeString } = require("./placementStartReminderUtils");

const REPORT_CASE_TYPES = [
  "terminated-placement",
  "completed-contract-assignment",
  "contractor-last-contact-overdue",
];
const DEFAULT_CASE_TYPES = REPORT_CASE_TYPES;
const DEFAULT_NOT_CONTACTED_DAYS = 30;
const DEFAULT_LIMIT = 500;
const LAST_CONTACT_DATE_FIELD = "dateLastComment";

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function parseDateKey(value, label = "date") {
  const normalized = normalizeString(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return normalized;
}

function dateKeyToStartMs(dateKey) {
  return new Date(`${parseDateKey(dateKey)}T00:00:00.000Z`).getTime();
}

function dateKeyToEndMs(dateKey) {
  return dateKeyToStartMs(dateKey) + 24 * 60 * 60 * 1000;
}

function parsePositiveInt(value, fallback, max = 5000) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseCaseTypes(value) {
  if (!value) return DEFAULT_CASE_TYPES;
  const caseTypes = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const unsupported = caseTypes.filter((caseType) => !REPORT_CASE_TYPES.includes(caseType));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported caseTypes: ${unsupported.join(", ")}`);
  }
  return Array.from(new Set(caseTypes));
}

function normalizeCountry(value) {
  const country = normalizeLower(value);
  if (["us", "usa", "united states of america"].includes(country)) {
    return "united states";
  }
  return country;
}

function getAssignmentCountry(placement) {
  return normalizeString(
    placement?.jobOrder?.address?.countryName ||
    placement?.address?.countryName ||
    placement?.clientCorporation?.address?.countryName ||
    placement?.candidate?.address?.countryName,
  );
}

function getAssignmentState(placement) {
  return normalizeString(placement?.jobOrder?.address?.state || placement?.address?.state);
}

function getCandidateCountry(placement) {
  return normalizeString(placement?.candidate?.address?.countryName);
}

function getCandidateState(placement) {
  return normalizeString(placement?.candidate?.address?.state);
}

function getEmploymentType(placement) {
  return normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
}

function dateValueToMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function calculateDaysSince(value, { baseDate = new Date() } = {}) {
  const ms = dateValueToMs(value);
  if (ms === null) return null;
  return Math.floor((baseDate.getTime() - ms) / (24 * 60 * 60 * 1000));
}

function isLastContactOverdue(placement, { notContactedDays, baseDate = new Date() }) {
  const value = placement?.candidate?.[LAST_CONTACT_DATE_FIELD];
  if (!value) return true;
  const daysSinceContact = calculateDaysSince(value, { baseDate });
  return daysSinceContact === null || daysSinceContact >= notContactedDays;
}

function normalizeFilters({
  dateFrom,
  dateTo,
  caseTypes,
  assignmentCountry,
  candidateCountry,
  employmentType,
  notContactedDays,
  limit,
} = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const from = parseDateKey(dateFrom || today, "dateFrom");
  const to = parseDateKey(dateTo || from, "dateTo");
  if (dateKeyToStartMs(from) > dateKeyToStartMs(to)) {
    throw new Error("dateFrom must be on or before dateTo");
  }
  return {
    dateFrom: from,
    dateTo: to,
    caseTypes: parseCaseTypes(caseTypes),
    assignmentCountry: normalizeString(assignmentCountry),
    candidateCountry: normalizeString(candidateCountry),
    employmentType: normalizeString(employmentType),
    notContactedDays: parsePositiveInt(notContactedDays, DEFAULT_NOT_CONTACTED_DAYS, 3650),
    limit: parsePositiveInt(limit, DEFAULT_LIMIT, 5000),
  };
}

function placementMatchesCommonFilters(placement, filters) {
  const assignmentCountry = normalizeCountry(getAssignmentCountry(placement));
  const candidateCountry = normalizeCountry(getCandidateCountry(placement));
  const employmentType = getEmploymentType(placement);

  if (filters.assignmentCountry && assignmentCountry !== normalizeCountry(filters.assignmentCountry)) {
    return false;
  }
  if (filters.candidateCountry && candidateCountry !== normalizeCountry(filters.candidateCountry)) {
    return false;
  }
  if (filters.employmentType && employmentType !== normalizeLower(filters.employmentType)) {
    return false;
  }
  return true;
}

function buildPlacementFields() {
  return [
    "id",
    "status",
    "dateBegin",
    "dateEnd",
    "dateLastModified",
    "employmentType",
    "candidate(id,firstName,lastName,name,email,status,address(countryName,state),dateLastComment)",
    "clientCorporation(id,name,address(countryName))",
    "jobOrder(id,title,employmentType,address(countryName,state),owner(id,firstName,lastName,email,pager))",
    "owner(id,firstName,lastName,email)",
  ].join(",");
}

function buildReportRecord({ caseType, placement, statusChange = null, baseDate = new Date(), notContactedDays }) {
  const candidate = placement?.candidate || {};
  const jobOrderOwner = placement?.jobOrder?.owner || placement?.owner || {};
  const dateLastComment = candidate?.[LAST_CONTACT_DATE_FIELD] || null;
  return {
    caseType,
    caseLabel: {
      "terminated-placement": "Terminated Placement",
      "completed-contract-assignment": "Completed Contract Assignment",
      "contractor-last-contact-overdue": "Contractor Last Contact Overdue",
    }[caseType] || caseType,
    candidate: {
      id: candidate?.id ?? null,
      name: normalizeString(candidate?.name) || buildFullName(candidate),
      email: normalizeString(candidate?.email),
      status: normalizeString(candidate?.status),
      country: getCandidateCountry(placement),
      state: getCandidateState(placement),
      dateLastComment,
    },
    placement: {
      id: placement?.id ?? null,
      status: normalizeString(placement?.status),
      employmentType: normalizeString(placement?.employmentType || placement?.jobOrder?.employmentType),
      dateBegin: placement?.dateBegin ?? null,
      dateEnd: placement?.dateEnd ?? null,
      dateLastModified: placement?.dateLastModified ?? null,
      assignmentCountry: getAssignmentCountry(placement),
      assignmentState: getAssignmentState(placement),
      clientCorporationId: placement?.clientCorporation?.id ?? null,
      clientCorporationName: normalizeString(placement?.clientCorporation?.name),
      jobOrderId: placement?.jobOrder?.id ?? null,
      jobTitle: normalizeString(placement?.jobOrder?.title),
      ownerId: jobOrderOwner?.id ?? null,
      ownerName: buildFullName(jobOrderOwner),
      ownerEmail: normalizeString(jobOrderOwner?.email),
    },
    lastContact: {
      field: LAST_CONTACT_DATE_FIELD,
      value: dateLastComment,
      daysSinceContact: calculateDaysSince(dateLastComment, { baseDate }),
      thresholdDays: notContactedDays,
    },
    statusChange: statusChange
      ? {
          oldValue: statusChange.oldValue ?? null,
          newValue: statusChange.newValue ?? null,
        }
      : null,
  };
}

module.exports = {
  DEFAULT_CASE_TYPES,
  DEFAULT_LIMIT,
  DEFAULT_NOT_CONTACTED_DAYS,
  LAST_CONTACT_DATE_FIELD,
  REPORT_CASE_TYPES,
  buildPlacementFields,
  buildReportRecord,
  dateKeyToEndMs,
  dateKeyToStartMs,
  getAssignmentCountry,
  getCandidateCountry,
  isLastContactOverdue,
  normalizeFilters,
  placementMatchesCommonFilters,
};
