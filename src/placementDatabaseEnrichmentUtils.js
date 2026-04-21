const PERM_EMPLOYMENT_TYPES = new Set(["perm", "contract to perm"]);
const EXCLUDED_PLACEMENT_STATUSES = new Set([
  "terminated",
  "rejected",
  "fall out",
  "temporarily suspended",
]);
const DATE_LAST_MODIFIED_ALLOWED_STATUSES = new Set(["approved"]);
function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return String(value).trim().toLowerCase();

  return value.trim().toLowerCase();
}

function isPermEmploymentType(value) {
  return PERM_EMPLOYMENT_TYPES.has(normalizeValue(value));
}

function addOneDay(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value + 24 * 60 * 60 * 1000;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

function extractFieldChanges(fieldChanges) {
  if (Array.isArray(fieldChanges)) {
    return fieldChanges;
  }

  if (Array.isArray(fieldChanges?.data)) {
    return fieldChanges.data;
  }

  return [];
}

function getStatusChangeFromEditHistory(editHistory) {
  const fieldChanges = extractFieldChanges(editHistory?.fieldChanges);

  return (
    fieldChanges.find((change) => normalizeValue(change?.columnName || change?.fieldName) === "status") ||
    null
  );
}

function isContractPlacementDatabaseEnrichmentStatusChange(statusChange) {
  if (!statusChange) return false;

  const oldValue = normalizeValue(statusChange.oldValue);
  const newValue = normalizeValue(statusChange.newValue);

  return newValue === "approved" && new Set(["", "qc approved", "submitted"]).has(oldValue);
}

function isPermPlacementDatabaseEnrichmentStatusChange(statusChange) {
  if (!statusChange) return false;

  return (
    normalizeValue(statusChange.oldValue) === "" &&
    normalizeValue(statusChange.newValue) === "approved"
  );
}

function getTimestampOffsetMinutes(value) {
  if (typeof value !== "string") {
    return 0;
  }

  if (/[zZ]$/.test(value)) {
    return 0;
  }

  const match = value.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function formatDateInOffset(baseDate, offsetMinutes) {
  const shifted = new Date(baseDate.getTime() + offsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function isPlacementDateLastModifiedMatch(placement, { baseDate = new Date() } = {}) {
  const rawValue = placement?.dateLastModified;
  if (!rawValue) {
    return false;
  }

  if (typeof rawValue === "string") {
    const datePart = rawValue.slice(0, 10);
    const currentDatePart = formatDateInOffset(baseDate, getTimestampOffsetMinutes(rawValue));
    return datePart === currentDatePart;
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.toISOString().slice(0, 10) === baseDate.toISOString().slice(0, 10);
}

function isPlacementDateLastModifiedStatusEligible(placement) {
  return DATE_LAST_MODIFIED_ALLOWED_STATUSES.has(normalizeValue(placement?.status));
}

function getPlacementDatabaseEnrichmentMatchReason(
  placement,
  statusChange,
  { baseDate = new Date() } = {},
) {
  const employmentType = normalizeValue(
    placement?.employmentType || placement?.jobOrder?.employmentType,
  );

  if (isPermEmploymentType(employmentType)) {
    if (isPermPlacementDatabaseEnrichmentStatusChange(statusChange)) {
      return "perm-approved-status-change";
    }
  } else if (isContractPlacementDatabaseEnrichmentStatusChange(statusChange)) {
    return "contract-approved-status-change";
  }

  if (
    isPlacementDateLastModifiedStatusEligible(placement) &&
    isPlacementDateLastModifiedMatch(placement, { baseDate })
  ) {
    return "date-last-modified";
  }

  return null;
}

function isDateOnOrAfterTodayUtc(value, { baseDate = new Date() } = {}) {
  if (value === null || value === undefined || value === "") return false;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  const valueDayStartMs = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const todayStartMs = Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    0,
    0,
    0,
    0,
  );

  return valueDayStartMs >= todayStartMs;
}

function buildCandidatePatchFromPlacementForDatabaseEnrichment(
  placement,
  { baseDate = new Date() } = {},
) {
  const candidateId = placement?.candidate?.id;
  if (!candidateId) return null;

  const employmentType = normalizeValue(
    placement?.employmentType || placement?.jobOrder?.employmentType,
  );
  const placementStatus = normalizeValue(placement?.status);
  const basePatch = {
    companyName: placement?.clientCorporation?.name ?? null,
    occupation: placement?.jobOrder?.title ?? null,
    status: "Placed by us",
  };

  if (isPermEmploymentType(employmentType)) {
    if (!isDateOnOrAfterTodayUtc(placement?.dateBegin, { baseDate })) {
      return null;
    }

    return {
      candidateId,
      ruleType: "perm-or-contract-to-perm",
      patch: basePatch,
    };
  }

  if (EXCLUDED_PLACEMENT_STATUSES.has(placementStatus)) {
    return null;
  }

  const patch = {
    ...basePatch,
    hourlyRateLow: placement?.payRate ?? null,
  };
  const dateAvailable = addOneDay(placement?.dateEnd);
  if (dateAvailable !== null) {
    patch.dateAvailable = dateAvailable;
  }

  return {
    candidateId,
    ruleType: "non-perm-active-placement",
    patch,
  };
}

function getFieldChanges(currentCandidate, patch) {
  const changes = [];

  for (const [field, newValue] of Object.entries(patch)) {
    const oldValue = currentCandidate?.[field] ?? null;
    if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }

  return changes;
}

module.exports = {
  addOneDay,
  buildCandidatePatchFromPlacementForDatabaseEnrichment,
  extractFieldChanges,
  getFieldChanges,
  getPlacementDatabaseEnrichmentMatchReason,
  getStatusChangeFromEditHistory,
  isContractPlacementDatabaseEnrichmentStatusChange,
  isDateOnOrAfterTodayUtc,
  isPermEmploymentType,
  isPermPlacementDatabaseEnrichmentStatusChange,
  isPlacementDateLastModifiedMatch,
  isPlacementDateLastModifiedStatusEligible,
  normalizeValue,
};
