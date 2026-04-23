const BLOCKED_CONTACT_NAME_PREFIXES = ["..", "****"];
const DNC_STATUS = "do not contact";
const DNC_STATUS_PATCH_VALUE = "Do Not Contact";
const ACTIVE_STATUS = "active";

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return String(value).trim().toLowerCase();

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

function buildContactName(contact) {
  const explicitName = typeof contact?.name === "string" ? contact.name.trim() : "";
  if (explicitName) return explicitName;

  const firstName = typeof contact?.firstName === "string" ? contact.firstName.trim() : "";
  const lastName = typeof contact?.lastName === "string" ? contact.lastName.trim() : "";
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function hasContactDelayPassed(contact, delayHours, now = Date.now()) {
  const dateAddedTimestamp = toTimestamp(contact?.dateAdded);
  if (dateAddedTimestamp === null) return false;

  return now >= dateAddedTimestamp + delayHours * 60 * 60 * 1000;
}

function isBlockedContactName(contact) {
  const normalizedName = normalizeValue(buildContactName(contact));
  if (!normalizedName) return false;

  return BLOCKED_CONTACT_NAME_PREFIXES.some((prefix) => normalizedName.startsWith(prefix));
}

function isClientCorporationDoNotContact(clientCorporation) {
  return normalizeValue(clientCorporation?.status) === DNC_STATUS;
}

function isContactDoNotContact(contact) {
  return normalizeValue(contact?.status) === DNC_STATUS;
}

function isClientCorporationStatusReactivation(statusChange) {
  return (
    normalizeValue(statusChange?.oldValue) === DNC_STATUS &&
    normalizeValue(statusChange?.newValue) === ACTIVE_STATUS
  );
}

function isClientCorporationStatusDoNotContactActivation(statusChange) {
  const oldValue = normalizeValue(statusChange?.oldValue);
  const newValue = normalizeValue(statusChange?.newValue);

  return (
    newValue === DNC_STATUS &&
    oldValue !== DNC_STATUS
  );
}

function toBullhornOptOutValue(value) {
  if (typeof value === "boolean") return value;

  const normalized = normalizeValue(value);
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;

  return value ?? null;
}

function buildDoNotContactPatch() {
  return {
    massMailOptOut: true,
    status: DNC_STATUS_PATCH_VALUE,
  };
}

function buildActivePatch() {
  return {
    massMailOptOut: false,
    status: "Active",
  };
}

function getContactChanges(currentContact, patch) {
  const changes = [];

  for (const [field, newValue] of Object.entries(patch)) {
    const oldValue =
      field === "massMailOptOut"
        ? toBullhornOptOutValue(currentContact?.[field])
        : currentContact?.[field] ?? null;

    if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }

  return changes;
}

function inferNewContactDoNotContactPatch(
  contact,
  { delayHours = 60, now = Date.now() } = {},
) {
  if (!isClientCorporationDoNotContact(contact?.clientCorporation)) {
    return null;
  }

  if (isContactDoNotContact(contact)) {
    return null;
  }

  if (isBlockedContactName(contact)) {
    return null;
  }

  if (!hasContactDelayPassed(contact, delayHours, now)) {
    return null;
  }

  return buildDoNotContactPatch();
}

function inferEventDrivenContactPatch({ statusChange, contact }) {
  if (isClientCorporationStatusReactivation(statusChange)) {
    if (isBlockedContactName(contact)) {
      return null;
    }

    if (!isContactDoNotContact(contact)) {
      return null;
    }

    return buildActivePatch();
  }

  if (isClientCorporationStatusDoNotContactActivation(statusChange)) {
    if (isBlockedContactName(contact)) {
      return null;
    }

    return buildDoNotContactPatch();
  }

  return null;
}

module.exports = {
  BLOCKED_CONTACT_NAME_PREFIXES,
  buildActivePatch,
  buildContactName,
  buildDoNotContactPatch,
  getContactChanges,
  hasContactDelayPassed,
  inferEventDrivenContactPatch,
  inferNewContactDoNotContactPatch,
  isBlockedContactName,
  isClientCorporationDoNotContact,
  isClientCorporationStatusDoNotContactActivation,
  isClientCorporationStatusReactivation,
  isContactDoNotContact,
  normalizeValue,
  toBullhornOptOutValue,
};
