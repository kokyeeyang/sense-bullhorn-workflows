const PERM_EMPLOYMENT_TYPES = new Set(["perm", "contract to perm"]);
const EXCLUDED_PLACEMENT_STATUSES = new Set([
  "terminated",
  "rejected",
  "fall out",
  "temporarily suspended",
]);
const ALLOWED_PREVIOUS_STATUSES = new Set(["", "qc approved", "submitted"]);

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return String(value).trim().toLowerCase();

  return value.trim().toLowerCase();
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

function buildPreviousUtcDayWindow({ baseDate = new Date(), daysBack = 1 } = {}) {
  const currentDayStartMs = Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const targetDayStartMs = currentDayStartMs - daysBack * 24 * 60 * 60 * 1000;

  return {
    startMs: targetDayStartMs,
    endMs: targetDayStartMs + 24 * 60 * 60 * 1000,
    targetDate: new Date(targetDayStartMs).toISOString().slice(0, 10),
    daysBack,
  };
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

function isTargetPlacementDatabaseEnrichmentStatusChange(statusChange) {
  if (!statusChange) return false;

  const oldValue = normalizeValue(statusChange.oldValue);
  const newValue = normalizeValue(statusChange.newValue);

  return (
    newValue === "approved" &&
    ALLOWED_PREVIOUS_STATUSES.has(oldValue)
  );
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

  if (PERM_EMPLOYMENT_TYPES.has(employmentType)) {
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
  buildPreviousUtcDayWindow,
  extractFieldChanges,
  getFieldChanges,
  getStatusChangeFromEditHistory,
  isDateOnOrAfterTodayUtc,
  isTargetPlacementDatabaseEnrichmentStatusChange,
};
