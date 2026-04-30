function normalizeStatus(value) {
  if (typeof value !== "string") return "";

  return value.trim().toLowerCase();
}

function isTargetPlacementStatusChange(statusChange) {
  if (!statusChange) return false;

  return (
    normalizeStatus(statusChange.oldValue) === "qc approved" &&
    normalizeStatus(statusChange.newValue) === "approved"
  );
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

function buildCandidatePatchFromPlacement(placement) {
  const candidateId = placement?.candidate?.id;
  if (!candidateId) return null;

  const patch = {
    companyName: placement.clientCorporation?.name ?? null,
    occupation: placement.jobOrder?.title ?? null,
    status: "Placed by us",
    hourlyRateLow: placement.payRate ?? null,
  };

  const dateAvailable = addOneDay(placement.dateEnd);
  if (dateAvailable !== null) {
    patch.dateAvailable = dateAvailable;
  }

  return {
    candidateId,
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
  buildCandidatePatchFromPlacement,
  getFieldChanges,
  isTargetPlacementStatusChange,
};
