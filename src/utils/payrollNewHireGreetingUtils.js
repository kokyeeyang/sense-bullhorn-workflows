const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, normalizeString } = require("./placementStartReminderUtils");
const { getPlacementCountry } = require("./harassmentTrainingUtils");

const WORKFLOW_NAME = "payroll-new-hire-greeting-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_AT_PACIFIC_HOUR = 7;
const QUERY_COUNT_DEFAULT = 200;
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const ELIGIBLE_STATUSES = new Set(["pre-hire", "qc approved", "approved"]);

let templateCache = null;

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeCountry(value) {
  const country = normalizeLower(value);
  if (["us", "usa", "united states of america"].includes(country)) {
    return "united states";
  }
  return country;
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

function loadTemplate() {
  if (!templateCache) {
    templateCache = fs.readFileSync(
      path.join(TEMPLATE_DIR, "payroll-new-hire-greeting.html"),
      "utf8",
    );
  }
  return templateCache;
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
}

function htmlToText(html) {
  return normalizeString(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
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

function getEmploymentType(placement) {
  return normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
}

function getMatchDetails(placement) {
  const status = normalizeLower(placement?.status);
  const country = normalizeCountry(getPlacementCountry(placement));
  const checks = {
    statusMatches: ELIGIBLE_STATUSES.has(status),
    employmentTypeMatches: getEmploymentType(placement) === "contract",
    countryMatches: country === "united states",
    candidateEmailPresent: Boolean(normalizeString(placement?.candidate?.email)),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      country: getPlacementCountry(placement) || null,
      candidateEmail: placement?.candidate?.email || null,
    },
    expected: {
      statusIn: Array.from(ELIGIBLE_STATUSES),
      employmentType: "contract",
      country: "united states",
    },
  };
}

function matchesPlacement(placement) {
  return getMatchDetails(placement).matched;
}

function buildTransmission({ placement }) {
  const toEmail = normalizeLower(placement?.candidate?.email);
  const candidateFirstName = normalizeString(placement?.candidate?.firstName) || "there";
  const html = renderTemplate(loadTemplate(), {
    "candidate.firstname": candidateFirstName,
    candidate_first_name: candidateFirstName,
  });

  return {
    content: {
      from: {
        name: "Spencer Ogden Payroll Department",
        email: "houseaccounts@spencer-ogden.com",
      },
      subject: "Important information on completing your Spencer Ogden payroll setup",
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

function buildReportRecord({ placement, businessDateKey, queryDate, transmission }) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDate,
    matchDetails: getMatchDetails(placement),
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      dateBegin: placement?.dateBegin || null,
      country: getPlacementCountry(placement) || null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
      candidateName: buildFullName(placement?.candidate),
    },
    recipient: transmission.recipientEnvelope,
    sparkPostPayload: {
      content: transmission.content,
      recipients: transmission.recipients,
    },
  };
}

module.exports = {
  QUERY_COUNT_DEFAULT,
  SEND_AT_PACIFIC_HOUR,
  TIME_ZONE,
  WORKFLOW_NAME,
  buildReportRecord,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  formatDateKey,
  getBusinessDateParts,
  getMatchDetails,
  matchesPlacement,
};
