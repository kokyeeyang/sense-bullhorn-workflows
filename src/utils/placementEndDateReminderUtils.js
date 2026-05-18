const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, formatDateBegin, normalizeString } = require("./placementStartReminderUtils");

const WORKFLOW_NAME = "placement-end-date-reminder-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_AT_PACIFIC_HOUR = 0;
const QUERY_COUNT_DEFAULT = 200;
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const EXCLUDED_STATUSES = new Set(["terminated", "fall out", "rejected", "pre-hire"]);

const REMINDER_STAGES = [
  { key: "day90", label: "90 day", dayOffset: 90 },
  { key: "day60", label: "60 day", dayOffset: 60 },
];

let templateCache = null;

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
    dayOfWeek: getDayOfWeek(`${parts.year}-${parts.month}-${parts.day}`),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
  };
}

function buildSendDateKeysForWeekendAdjust(businessDateKey) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (dayOfWeek === 5) return [businessDateKey, addDays(businessDateKey, 1)];
  if (dayOfWeek === 1) return [addDays(businessDateKey, -1), businessDateKey];
  if (dayOfWeek === 0 || dayOfWeek === 6) return [];
  return [businessDateKey];
}

function buildQueryPlan({ businessDateKey }) {
  const sendDateKeys = buildSendDateKeysForWeekendAdjust(businessDateKey);
  return REMINDER_STAGES.map((stage) => ({
    stageKey: stage.key,
    stageLabel: stage.label,
    dayOffset: stage.dayOffset,
    dateEndDates: sendDateKeys.map((sendDateKey) => addDays(sendDateKey, stage.dayOffset)),
  }));
}

function loadTemplate() {
  if (!templateCache) {
    templateCache = fs.readFileSync(
      path.join(TEMPLATE_DIR, "placement-end-date-reminder.html"),
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

function isDateEndOnOrAfter(dateEnd, dateKey) {
  const date = new Date(dateEnd);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() >= dateKeyToUtcDate(dateKey).getTime();
}

function getMatchDetails(placement, { businessDateKey }) {
  const employmentType = getEmploymentType(placement);
  const status = normalizeLower(placement?.status);
  const checks = {
    employmentTypeMatches: ["contract", "margin only"].includes(employmentType),
    dateEndOnOrAfterBusinessDate: isDateEndOnOrAfter(placement?.dateEnd, businessDateKey),
    statusAllowed: !EXCLUDED_STATUSES.has(status),
    jobOrderOwnerEmailPresent: Boolean(normalizeString(placement?.jobOrder?.owner?.email)),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      dateEnd: placement?.dateEnd ?? null,
      status: placement?.status || null,
      jobOrderOwnerEmail: placement?.jobOrder?.owner?.email || null,
    },
    expected: {
      employmentTypeIn: ["contract", "margin only"],
      dateEndOnOrAfter: businessDateKey,
      statusNotIn: Array.from(EXCLUDED_STATUSES),
    },
  };
}

function matchesPlacement(placement, options) {
  return getMatchDetails(placement, options).matched;
}

function uniqueEmails(values, { exclude = [] } = {}) {
  const excludeSet = new Set(exclude.map((value) => normalizeLower(value)).filter(Boolean));
  const seen = new Set();
  const emails = [];
  for (const value of values) {
    const email = normalizeLower(value);
    if (!email || seen.has(email) || excludeSet.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

function buildRecipientEnvelope({ placement }) {
  const toEmail = normalizeLower(placement?.jobOrder?.owner?.email);
  const ccEmails = uniqueEmails([placement?.jobOrder?.owner?.reportToPerson?.email], {
    exclude: [toEmail],
  });
  const bccEmails = uniqueEmails([placement?.jobOrder?.assignedUser?.email || placement?.jobOrder?.assigneduser?.email], {
    exclude: [toEmail, ...ccEmails],
  });

  return {
    toEmail,
    ccEmails,
    bccEmails,
    missingToEmail: !toEmail,
  };
}

function buildTransmission({ placement, stage }) {
  const recipientEnvelope = buildRecipientEnvelope({ placement });
  const owner = placement?.jobOrder?.owner || {};
  const clientContact = placement?.clientContact || placement?.billingClientContact || {};
  const html = renderTemplate(loadTemplate(), {
    "owner.firstname": normalizeString(owner.firstName),
    "candidate.name": buildFullName(placement?.candidate),
    "clientContact.companyname": normalizeString(
      clientContact?.companyName ||
      clientContact?.clientCorporation?.name ||
      placement?.clientCorporation?.name,
    ),
    "clientContact.name": buildFullName(clientContact),
    dateend: formatDateBegin(placement?.dateEnd),
  });
  const subject = `${stage.dayOffset} day Placement End Date Reminder ${normalizeString(placement?.id)} - ${buildFullName(placement?.candidate)}`;
  const headers = recipientEnvelope.ccEmails.length
    ? { CC: recipientEnvelope.ccEmails.join(", ") }
    : undefined;

  const recipients = [
    recipientEnvelope.toEmail ? { address: { email: recipientEnvelope.toEmail } } : null,
    ...recipientEnvelope.ccEmails.map((email) => ({
      address: { email, header_to: recipientEnvelope.toEmail },
    })),
    ...recipientEnvelope.bccEmails.map((email) => ({
      address: { email, header_to: recipientEnvelope.toEmail },
    })),
  ].filter(Boolean);

  return {
    content: {
      from: {
        name: "Sales Operations Team",
        email: "noreply@spencer-ogden.com",
      },
      subject,
      text: htmlToText(html),
      html,
      ...(headers ? { headers } : {}),
    },
    recipients,
    recipientEnvelope,
  };
}

function buildReportRecord({ placement, stage, businessDateKey, queryDate, transmission }) {
  return {
    placementId: placement?.id ?? null,
    stage: {
      key: stage.key,
      label: stage.label,
      dayOffset: stage.dayOffset,
    },
    businessDate: businessDateKey,
    queryDate,
    matchDetails: getMatchDetails(placement, { businessDateKey }),
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      dateEnd: placement?.dateEnd || null,
      dateEndFormatted: formatDateBegin(placement?.dateEnd) || null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      clientContact: placement?.clientContact || placement?.billingClientContact || null,
      jobOrder: placement?.jobOrder || null,
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
  REMINDER_STAGES,
  SEND_AT_PACIFIC_HOUR,
  TIME_ZONE,
  WORKFLOW_NAME,
  addDays,
  buildQueryPlan,
  buildReportRecord,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  matchesPlacement,
};
