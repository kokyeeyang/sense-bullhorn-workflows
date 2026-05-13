const fs = require("node:fs");
const path = require("node:path");

const { normalizeString } = require("./placementStartReminderUtils");

const WORKFLOW_NAME = "fair-collection-notice-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const SEND_AT_PACIFIC_HOUR = 6;
const MINIMUM_DATE_ADDED = "2018-05-24";
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const TEMPLATE_PATH = "fair-collection-notice.html";

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

function htmlToText(html) {
  return normalizeString(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
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

function loadTemplate() {
  return fs.readFileSync(path.join(TEMPLATE_DIR, TEMPLATE_PATH), "utf8");
}

function getMatchDetails(candidate) {
  const dateAdded = Number(candidate?.dateAdded || 0);
  const minimumDateAdded = dateKeyToUtcDate(MINIMUM_DATE_ADDED).getTime();
  const checks = {
    candidateEmailPresent: Boolean(normalizeLower(candidate?.email)),
    dateAddedMatches: Boolean(dateAdded && dateAdded >= minimumDateAdded),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      candidateEmail: candidate?.email || null,
      dateAdded: candidate?.dateAdded ?? null,
    },
    expected: {
      dateAddedOnOrAfter: minimumDateAdded,
    },
  };
}

function buildTransmission({ candidate }) {
  const html = loadTemplate();
  const toEmail = normalizeLower(candidate?.email);

  return {
    content: {
      from: {
        name: "Spencer Ogden",
        email: "onboarding@spencer-ogden.com",
      },
      subject: "Fair Collection Notice From Spencer Ogden",
      text: htmlToText(html),
      html,
    },
    recipients: toEmail ? [{ address: { email: toEmail } }] : [],
    recipientEnvelope: {
      toEmail,
      missingToEmail: !toEmail,
    },
  };
}

module.exports = {
  MINIMUM_DATE_ADDED,
  QUERY_COUNT_DEFAULT,
  SEND_AT_PACIFIC_HOUR,
  TIME_ZONE,
  WORKFLOW_NAME,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
};
