const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, normalizeString } = require("./placementStartReminderUtils");

const WORKFLOW_NAME = "ais-survivex-certification-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const EXPIRATION_OFFSET_DAYS = 90;
const SEND_AT_PACIFIC_HOUR = 2;
const REQUIRED_OWNER_NAME = "joe mccormick";
const ATTACHMENT_PATH = "attachments/AIS-Survivex-Spencer Ogden-contractor-discount-banner.jpg";
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");

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

function isTimedRuleDue({ businessHour, force = false }) {
  return force || Number(businessHour) === SEND_AT_PACIFIC_HOUR;
}

function getCandidate(certification) {
  return certification?.candidate || {};
}

function getCandidateLastPlacementStarted(candidate) {
  return (
    candidate?.dateLastPlacementStarted ||
    candidate?.date_last_placement_started ||
    candidate?.customDateLastPlacementStarted ||
    null
  );
}

function getMatchDetails(certification, { businessDateKey } = {}) {
  const candidate = getCandidate(certification);
  const ownerName = buildFullName(candidate?.owner);
  const lastPlacementStarted = Number(getCandidateLastPlacementStarted(candidate) || 0);
  const ninetyDaysAgo = dateKeyToUtcDate(addDays(businessDateKey, -90)).getTime();
  const checks = {
    candidateEmailPresent: Boolean(normalizeString(candidate?.email)),
    ownerMatches: normalizeLower(ownerName) === REQUIRED_OWNER_NAME,
    lastPlacementStartedAfter90DaysAgo: Boolean(lastPlacementStarted && lastPlacementStarted > ninetyDaysAgo),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      candidateEmail: candidate?.email || null,
      ownerName: ownerName || null,
      lastPlacementStarted: getCandidateLastPlacementStarted(candidate),
    },
    expected: {
      ownerName: "Joe McCormick",
      lastPlacementStartedAfter: ninetyDaysAgo,
    },
  };
}

function loadTemplate() {
  return fs.readFileSync(path.join(TEMPLATE_DIR, "ais-survivex-certification-renewal.html"), "utf8");
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
    .split("\n")
    .map((line) => normalizeString(line))
    .filter(Boolean)
    .join("\n");
}

function buildAttachment(filePath) {
  return {
    name: path.basename(filePath),
    type: "image/jpeg",
    data: fs.readFileSync(filePath).toString("base64"),
  };
}

function findAttachmentPath() {
  const resolved = path.resolve(process.cwd(), ATTACHMENT_PATH);
  return fs.existsSync(resolved) ? resolved : null;
}

function buildTransmission({ certification, attachments = [] }) {
  const candidate = getCandidate(certification);
  const html = renderTemplate(loadTemplate(), {
    candidate_first_name: normalizeString(candidate?.firstName),
  });
  const toEmail = normalizeLower(candidate?.email);

  return {
    content: {
      from: {
        name: "Spencer Ogden",
        email: "noreply@spencer-ogden.com",
      },
      subject: "Your certificate is due for renewal",
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
  EXPIRATION_OFFSET_DAYS,
  QUERY_COUNT_DEFAULT,
  SEND_AT_PACIFIC_HOUR,
  TIME_ZONE,
  WORKFLOW_NAME,
  addDays,
  buildAttachment,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  findAttachmentPath,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
};
