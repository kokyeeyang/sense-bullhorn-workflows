const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, normalizeString } = require("./placementStartReminderUtils");

const WORKFLOW_NAME = "awr-client-request-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const SEND_AT_PACIFIC_HOUR = 18;
const INITIAL_OFFSET_DAYS = 14;
const REMINDER_OFFSET_DAYS = 44;
const ATTACHMENT_PATH = "attachments/AWR Client Declaration.pdf";
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "awr-client-request.html");
const BCC_EMAILS = ["emeacompliance@spencer-ogden.com"];

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

function buildDateBeginQueryDates({ businessDateKey, offsetDays }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (dayOfWeek === 0 || dayOfWeek === 6) return [];
  const dueDates = dayOfWeek === 1
    ? [addDays(businessDateKey, -2), addDays(businessDateKey, -1), businessDateKey]
    : [businessDateKey];
  return dueDates.map((dueDate) => addDays(dueDate, -offsetDays));
}

function getPlacementCountry(placement) {
  return normalizeLower(
    placement?.address?.countryName ||
    placement?.jobOrder?.address?.countryName ||
    placement?.clientCorporation?.address?.countryName ||
    placement?.billingClientContact?.address?.countryName,
  );
}

function getClientContact(placement) {
  return placement?.clientContact || placement?.billingClientContact || {};
}

function getVendorType(placement) {
  return normalizeLower(placement?.vendorType || placement?.customText8 || placement?.customText10);
}

function getMatchDetails(placement) {
  const status = normalizeLower(placement?.status);
  const checks = {
    statusMatches: status.includes("qc approved") || status.includes("approved"),
    employmentTypeMatches: normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType) === "contract",
    countryMatches: ["united kingdom", "uk", "gb", "great britain"].includes(getPlacementCountry(placement)),
    vendorTypeMatches: getVendorType(placement) === "management company",
  };
  return {
    matched: Object.values(checks).every(Boolean),
    checks,
    failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key),
    actual: {
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      country: getPlacementCountry(placement) || null,
      vendorType: getVendorType(placement) || null,
    },
    expected: {
      statusesContain: ["qc approved", "approved"],
      employmentType: "contract",
      country: "united kingdom",
      vendorType: "management company",
    },
  };
}

function matchesPlacement(placement) {
  return getMatchDetails(placement).matched;
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
}

function loadTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, "utf8");
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

function buildAttachment(filePath) {
  const resolvedPath = path.resolve(filePath);
  return {
    name: path.basename(resolvedPath),
    type: "application/pdf",
    data: fs.readFileSync(resolvedPath).toString("base64"),
  };
}

function buildTransmission({ placement, sendType }) {
  const clientContact = getClientContact(placement);
  const toEmail = normalizeLower(clientContact?.email);
  const bccEmails = BCC_EMAILS.filter((email) => email !== toEmail);
  const reminderIntroHtml = sendType === "reminder"
    ? '<p style="margin:0 0 18px; font-size:16px; line-height:24px;">This is a reminder regarding the AWR information request below.</p>'
    : "";
  const html = renderTemplate(loadTemplate(), {
    reminder_intro_html: reminderIntroHtml,
    client_contact_first_name: escapeHtml(clientContact?.firstName || "there"),
    candidate_name: escapeHtml(buildFullName(placement?.candidate)),
  });
  const recipients = [
    { address: { email: toEmail } },
    ...bccEmails.map((email) => ({ address: { email, header_to: toEmail } })),
  ].filter((recipient) => normalizeString(recipient?.address?.email));

  return {
    content: {
      from: {
        name: "Spencer Ogden Compliance",
        email: "emea.ccs@spencer-ogden.com",
      },
      subject: sendType === "reminder" ? "Reminder: AWR Information Request" : "AWR Information Request",
      text: htmlToText(html),
      html,
      attachments: [buildAttachment(ATTACHMENT_PATH)],
    },
    recipients,
    recipientEnvelope: {
      toEmail,
      bccEmails,
      missingClientContactEmail: !toEmail,
    },
    attachmentPaths: [path.resolve(ATTACHMENT_PATH)],
  };
}

module.exports = {
  ATTACHMENT_PATH,
  BCC_EMAILS,
  INITIAL_OFFSET_DAYS,
  QUERY_COUNT_DEFAULT,
  REMINDER_OFFSET_DAYS,
  SEND_AT_PACIFIC_HOUR,
  TIME_ZONE,
  WORKFLOW_NAME,
  buildDateBeginQueryDates,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
  matchesPlacement,
};
