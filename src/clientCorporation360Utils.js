const EXCLUDED_CLIENT_CORPORATION_PREFIXES = [
  "siemens",
  "general electric",
  "ge/",
  "abb",
  "abo",
  "abode",
  "acciona",
  "acen",
  "aes",
  "aesi",
  "aesg",
  "air",
  "ansaldo",
  "bhp",
  "bis",
  "black and veatch",
  "blue",
  "blue power",
  "burns & mcdonnell",
  "canadian solar",
  "dashiell",
  "dominion",
  "dresser rand",
  "duke energy",
  "edf",
  "elgin",
  "enbw",
  "engie",
  "envision",
  "esb",
  "esbi",
  "expro",
  "exyte",
  "fieldcore",
  "fluence",
  "guidant",
  "halliburton",
  "harvey nash b.v.",
  "hays",
  "hitachi",
  "kelly services",
  "lg energy",
  "lightsource",
  "magnit",
  "mhi",
  "mitsubishi",
  "morson",
  "mubadala",
  "nexamp",
  "nordex",
  "optima",
  "optimal",
  "orsted",
  "petronas",
  "randstad",
  "resolve",
  "rwe",
  "sany",
  "schneider",
  "scottish power",
  "sse",
  "tm",
  "total",
  "uniper - randstad",
  "vattenfall",
  "vestas",
  "zerochaos - usa",
  "zerochaos (nordic) aps",
  "ge a",
  "ge b",
  "ge c",
  "ge d",
  "ge e",
  "ge f",
  "ge h",
  "ge i",
  "ge k",
  "ge l",
  "ge m",
  "ge n",
  "ge o",
  "ge p",
  "ge r",
  "ge s",
  "ge t",
  "ge u",
  "ge v",
  "ge w",
  "res a",
  "res d",
  "res e",
  "res f",
  "res i",
  "res j",
  "res m",
  "res r",
  "res s",
];

function normalizeValue(value) {
  if (typeof value !== "string") return "";

  return value.trim().toLowerCase();
}

function toTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.getTime();
}

function isEmptyCustomText7(value) {
  return value === null || value === undefined || normalizeValue(value) === "";
}

function isListedClientCorporationName(name) {
  const normalizedName = normalizeValue(name);
  if (!normalizedName) return false;

  return EXCLUDED_CLIENT_CORPORATION_PREFIXES.some((prefix) =>
    normalizedName.startsWith(prefix),
  );
}

function isExcludedClientCorporationName(name) {
  return isListedClientCorporationName(name);
}

function hasClientCorporationDelayPassed(clientCorporation, delayHours, now = Date.now()) {
  const dateAddedTimestamp = toTimestamp(clientCorporation?.dateAdded);
  if (dateAddedTimestamp === null) return false;

  const delayMs = delayHours * 60 * 60 * 1000;
  return now >= dateAddedTimestamp + delayMs;
}

function inferClientCorporation360Patch(clientCorporation, { delayHours = 24, now = Date.now() } = {}) {
  if (!isEmptyCustomText7(clientCorporation?.customText7)) {
    return null;
  }

  if (isListedClientCorporationName(clientCorporation?.name)) {
    return null;
  }

  if (!hasClientCorporationDelayPassed(clientCorporation, delayHours, now)) {
    return null;
  }

  return {
    customText7: "360",
  };
}

function getClientCorporationChanges(currentClientCorporation, patch) {
  const changes = [];

  for (const [field, newValue] of Object.entries(patch)) {
    const oldValue = currentClientCorporation?.[field] ?? null;
    if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }

  return changes;
}

module.exports = {
  EXCLUDED_CLIENT_CORPORATION_PREFIXES,
  getClientCorporationChanges,
  hasClientCorporationDelayPassed,
  inferClientCorporation360Patch,
  isEmptyCustomText7,
  isExcludedClientCorporationName,
  isListedClientCorporationName,
};
