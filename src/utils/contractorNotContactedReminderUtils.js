const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, normalizeString } = require("./placementStartReminderUtils");

const WORKFLOW_NAME = "contractor-not-contacted-reminder-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const SEND_AT_PACIFIC_HOUR = 14;
const CONTACT_DELAY_DAYS = 30;
const DEFAULT_LAST_NOTE_DATE_FIELD = "dateLastComment";
const DEFAULT_LAST_NOTE_ACTION_TYPE_FIELD = "customText16";
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "contractor-not-contacted-reminder.html");

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateKeyToUtcDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(dateKey))) throw new Error(`Invalid date key: ${dateKey}`);
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
  const parts = Object.fromEntries(formatter.formatToParts(baseDate).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  return { dateKey, dayOfWeek: getDayOfWeek(dateKey), hour: Number(parts.hour === "24" ? "0" : parts.hour) };
}

function isTimedRuleDue({ businessHour, dayOfWeek, force = false }) {
  return force || (businessHour === SEND_AT_PACIFIC_HOUR && dayOfWeek >= 1 && dayOfWeek <= 5);
}

function buildLastContactQueryDates({ businessDateKey }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (dayOfWeek === 0 || dayOfWeek === 6) return [];
  if (dayOfWeek === 5) return [addDays(businessDateKey, -CONTACT_DELAY_DAYS), addDays(businessDateKey, 1 - CONTACT_DELAY_DAYS)];
  if (dayOfWeek === 1) return [addDays(businessDateKey, -1 - CONTACT_DELAY_DAYS), addDays(businessDateKey, -CONTACT_DELAY_DAYS)];
  return [addDays(businessDateKey, -CONTACT_DELAY_DAYS)];
}

function getPlacementCountry(placement) {
  return normalizeLower(
    placement?.address?.countryName ||
    placement?.jobOrder?.address?.countryName ||
    placement?.clientCorporation?.address?.countryName,
  );
}

function getCandidateField(candidate, fieldName) {
  return candidate?.[fieldName];
}

function getMatchDetails({ placement, candidate, dateField, actionTypeField }) {
  const actionValue = actionTypeField ? getCandidateField(candidate, actionTypeField) : "";
  const checks = {
    statusMatches: normalizeLower(placement?.status) === "approved",
    employmentTypeMatches: normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType) === "contract",
    ownerPagerMatches: normalizeString(placement?.jobOrder?.owner?.pager) === "500",
    countryMatches: ["united states", "us", "usa", "united states of america"].includes(getPlacementCountry(placement)),
    actionTypeAllowed: !actionTypeField || normalizeLower(actionValue) !== "sense communication sent",
  };
  return {
    matched: Object.values(checks).every(Boolean),
    checks,
    failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key),
    actual: {
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      ownerPager: placement?.jobOrder?.owner?.pager || null,
      country: getPlacementCountry(placement) || null,
      lastNoteDateField: dateField,
      lastNoteDate: getCandidateField(candidate, dateField) ?? null,
      lastNoteActionTypeField: actionTypeField || null,
      lastNoteActionType: actionValue || null,
    },
  };
}

function matchesPlacement(args) {
  return getMatchDetails(args).matched;
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
}

function htmlToText(html) {
  return normalizeString(html)
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => normalizeString(line))
    .filter(Boolean)
    .join("\n");
}

function buildTransmission({ placement }) {
  const owner = placement?.jobOrder?.owner || {};
  const toEmail = normalizeLower(owner?.email);
  const html = renderTemplate(fs.readFileSync(TEMPLATE_PATH, "utf8"), {
    job_order_owner_name: escapeHtml(buildFullName(owner) || "there"),
    candidate_name: escapeHtml(buildFullName(placement?.candidate)),
  });
  return {
    content: {
      from: {
        name: "Sales Operation Team",
        email: "noreply@spencer-ogden.com",
      },
      subject: "Reminder to contact a Contractor",
      text: htmlToText(html),
      html,
    },
    recipients: toEmail ? [{ address: { email: toEmail } }] : [],
    recipientEnvelope: {
      toEmail,
      missingJobOrderOwnerEmail: !toEmail,
    },
  };
}

module.exports = {
  CONTACT_DELAY_DAYS,
  DEFAULT_LAST_NOTE_ACTION_TYPE_FIELD,
  DEFAULT_LAST_NOTE_DATE_FIELD,
  QUERY_COUNT_DEFAULT,
  SEND_AT_PACIFIC_HOUR,
  TIME_ZONE,
  WORKFLOW_NAME,
  buildLastContactQueryDates,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
  matchesPlacement,
};
