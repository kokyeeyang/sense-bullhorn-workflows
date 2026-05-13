const fs = require("node:fs");
const path = require("node:path");

const { normalizeString } = require("./placementStartReminderUtils");

const WORKFLOW_NAME = "americas-welcome-contract-email-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const TARGET_ACTION_TYPE = "talent platform initiated";
const MINIMUM_DATE_ADDED = "2019-01-01";
const ATTACHMENT_PATH = "attachments/Verified First Candidate Screenshots.pdf";
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const EXCLUDED_FIRST_NAME_FRAGMENTS = [
  "****",
  "??",
  "?",
  "--",
  "-",
  "?ukasz",
  "???",
  "?leti?im",
  "?????",
  "??????",
  "???????",
  "????",
  "?brah?m",
  ".",
  ". mehdi",
  "..",
  "...",
  ".n",
  "********",
  "************",
  "** do not contact**",
  "**duplicate use-bh# 1141205",
  "**duplicate** paul",
];

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function validateDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(value))) {
    throw new Error(`Invalid date key: ${value}`);
  }
}

function dateKeyToUtcDate(dateKey) {
  validateDateKey(dateKey);
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function getDayOfWeek(dateKey) {
  return dateKeyToUtcDate(dateKey).getUTCDay();
}

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return { startMs, endMs: startMs + DAY_MS, targetDate: dateKey };
}

function getBusinessDateParts({ baseDate = new Date(), timeZone = TIME_ZONE } = {}) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(baseDate)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
  };
}

function buildImmediateChangeDateKeys({ businessDateKey, weekendAdjust = true }) {
  if (!weekendAdjust) return [businessDateKey];
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (dayOfWeek === 1) return [addDays(businessDateKey, -2), addDays(businessDateKey, -1), businessDateKey];
  if (dayOfWeek === 0 || dayOfWeek === 6) return [];
  return [businessDateKey];
}

function extractFieldChanges(fieldChanges) {
  if (Array.isArray(fieldChanges)) return fieldChanges;
  if (Array.isArray(fieldChanges?.data)) return fieldChanges.data;
  return [];
}

function findLastNoteActionTypeChange(record) {
  const fieldNames = new Set([
    "last_note_action_type",
    "lastnoteactiontype",
    "lastNoteActionType",
    "customTextLastNoteActionType",
  ].map((value) => normalizeLower(value)));

  return extractFieldChanges(record?.fieldChanges).find((change) =>
    fieldNames.has(normalizeLower(change.columnName || change.fieldName)),
  ) || null;
}

function firstNameHasExcludedFragment(firstName) {
  const normalized = normalizeLower(firstName);
  return EXCLUDED_FIRST_NAME_FRAGMENTS.some((fragment) => normalized.includes(normalizeLower(fragment)));
}

function getCandidateCountry(candidate) {
  return candidate?.address?.countryName || candidate?.address?.country || "";
}

function getCandidateActionType(candidate, actionTypeField) {
  return candidate?.[actionTypeField] ?? candidate?.last_note_action_type ?? candidate?.lastNoteActionType ?? "";
}

function buildCurrentActionTypeChange(candidate, actionTypeField) {
  return {
    oldValue: null,
    newValue: getCandidateActionType(candidate, actionTypeField),
  };
}

function getMatchDetails(candidate, { change, actionTypeField = "customText16" } = {}) {
  const actionChange = change || buildCurrentActionTypeChange(candidate, actionTypeField);
  const newValue = normalizeLower(actionChange?.newValue);
  const dateAdded = Number(candidate?.dateAdded || 0);
  const minimumDateAdded = dateKeyToUtcDate(MINIMUM_DATE_ADDED).getTime();
  const checks = {
    actionTypeMatches: newValue === TARGET_ACTION_TYPE,
    countryMatches: normalizeLower(getCandidateCountry(candidate)) === "united states",
    dateAddedMatches: Boolean(dateAdded && dateAdded > minimumDateAdded),
    firstNameAllowed: !firstNameHasExcludedFragment(candidate?.firstName),
    candidateEmailPresent: Boolean(normalizeString(candidate?.email)),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      newValue: actionChange?.newValue ?? null,
      country: getCandidateCountry(candidate) || null,
      dateAdded: candidate?.dateAdded ?? null,
      firstName: candidate?.firstName || null,
      email: candidate?.email || null,
      actionTypeField,
    },
    expected: {
      newValue: "Talent platform initiated",
      country: "united states",
      dateAddedAfter: minimumDateAdded,
      excludedFirstNameFragments: EXCLUDED_FIRST_NAME_FRAGMENTS,
    },
  };
}

function loadTemplate() {
  return fs.readFileSync(path.join(TEMPLATE_DIR, "americas-welcome-contract-email.html"), "utf8");
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
}

function htmlToText(html) {
  return normalizeString(html)
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => normalizeString(line))
    .filter(Boolean)
    .join("\n");
}

function findAttachmentPath() {
  const resolved = path.resolve(process.cwd(), ATTACHMENT_PATH);
  return fs.existsSync(resolved) ? resolved : null;
}

function buildAttachment(filePath) {
  return {
    name: path.basename(filePath),
    type: "application/pdf",
    data: fs.readFileSync(filePath).toString("base64"),
  };
}

function buildTransmission({ candidate, attachments = [] }) {
  const html = renderTemplate(loadTemplate(), {
    candidate_first_name: normalizeString(candidate?.firstName),
  });
  const toEmail = normalizeLower(candidate?.email);

  return {
    content: {
      from: {
        name: "Spencer Ogden CCS",
        email: "onboarding@spencer-ogden.com",
      },
      subject: "Important- Spencer Ogden Onboarding",
      text: htmlToText(html),
      html,
      ...(attachments.length ? { attachments } : {}),
    },
    recipients: toEmail ? [{ address: { email: toEmail } }] : [],
    recipientEnvelope: {
      toEmail,
      missingToEmail: !toEmail,
    },
  };
}

module.exports = {
  ATTACHMENT_PATH,
  EXCLUDED_FIRST_NAME_FRAGMENTS,
  MINIMUM_DATE_ADDED,
  QUERY_COUNT_DEFAULT,
  TARGET_ACTION_TYPE,
  WORKFLOW_NAME,
  buildAttachment,
  buildCurrentActionTypeChange,
  buildImmediateChangeDateKeys,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  findAttachmentPath,
  findLastNoteActionTypeChange,
  firstNameHasExcludedFragment,
  getBusinessDateParts,
  getCandidateActionType,
  getMatchDetails,
};
