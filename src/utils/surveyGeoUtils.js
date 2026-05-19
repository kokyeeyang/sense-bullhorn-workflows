function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function normalizeRegion(value) {
  const normalized = normalizeString(value);
  const lower = normalized.toLowerCase();
  if (lower === "emea") return "EMEA";
  if (lower === "apac") return "APAC";
  if (["americas", "america", "us", "usa", "united states"].includes(lower)) {
    return "Americas";
  }
  return normalized;
}

function getCountryName(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeString(value);
  return normalizeString(value.countryName || value.country || value.name);
}

function getCandidateCountry(placement) {
  return getCountryName(placement?.candidate?.address);
}

function getAssignmentCountry(placement) {
  return (
    getCountryName(placement?.jobOrder?.address) ||
    getCountryName(placement?.clientCorporation?.address) ||
    getCountryName(placement?.address) ||
    getCandidateCountry(placement)
  );
}

function inferRegionFromCountry(country) {
  const normalized = normalizeString(country).toLowerCase();
  if (!normalized) return "";

  if (
    [
      "united states",
      "united states of america",
      "usa",
      "us",
      "canada",
      "mexico",
      "brazil",
      "argentina",
      "chile",
      "colombia",
      "peru",
    ].includes(normalized)
  ) {
    return "Americas";
  }

  if (
    [
      "australia",
      "new zealand",
      "malaysia",
      "singapore",
      "india",
      "indonesia",
      "philippines",
      "thailand",
      "vietnam",
      "china",
      "hong kong",
      "japan",
      "south korea",
      "korea; republic of (south)",
    ].includes(normalized)
  ) {
    return "APAC";
  }

  return "EMEA";
}

function buildSurveyGeoFields(placement, { assignmentRegion = "", candidateRegion = "" } = {}) {
  const candidateCountry = getCandidateCountry(placement);
  const assignmentCountry = getAssignmentCountry(placement);

  return {
    candidateCountry,
    candidateRegion: normalizeString(candidateRegion) || inferRegionFromCountry(candidateCountry),
    assignmentCountry,
    assignmentRegion: normalizeString(assignmentRegion) || inferRegionFromCountry(assignmentCountry),
  };
}

function extractSurveyGeoFields(source = {}) {
  const metadata = source.metadata || {};
  const context = source.context || {};

  return {
    candidateRegion: normalizeRegion(
      source.candidateRegion || metadata.candidateRegion || metadata.region || context.candidateRegion,
    ),
    candidateCountry: normalizeString(
      source.candidateCountry || metadata.candidateCountry || context.candidateCountry,
    ),
    assignmentRegion: normalizeRegion(
      source.assignmentRegion || metadata.assignmentRegion || metadata.region || context.assignmentRegion,
    ),
    assignmentCountry: normalizeString(
      source.assignmentCountry || metadata.assignmentCountry || context.assignmentCountry || context.country,
    ),
  };
}

module.exports = {
  buildSurveyGeoFields,
  extractSurveyGeoFields,
  getAssignmentCountry,
  getCandidateCountry,
  inferRegionFromCountry,
  normalizeRegion,
};
