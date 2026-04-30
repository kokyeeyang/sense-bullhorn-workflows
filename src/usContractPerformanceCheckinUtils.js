const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, formatDateBegin, normalizeString } = require("./placementStartReminderUtils");

const PERFORMANCE_CHECKIN_TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKIN_DAY_OFFSET = 28;
const STANDARD_CRITERIA_MIN_DATE_BEGIN = "2024-01-01";

const INCLUDED_EMPLOYMENT_TYPES = new Set(["contract", "margin only", "marginonly"]);
const EXCLUDED_CLIENT_CORPORATION_IDS = new Set([
  "142049",
  "112690",
  "56259",
  "46981",
  "44878",
  "37785",
  "34056",
  "20432",
  "3061",
  "61984",
  "62037",
  "94901",
]);
const EXCLUDED_STATUS_VALUES = new Set([
  "terminated",
  "fall out",
  "rejected",
  "pre-hire",
  "submitted",
]);
const DO_NOT_CONTACT_STATUS = "do not contact";
const HTML_TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "templates",
  "us-contract-performance-checkin.html",
);
const SKIPPED_PREVIEW_LIMIT = 25;

let cachedHtmlTemplate = null;

function loadHtmlTemplate() {
  if (!cachedHtmlTemplate) {
    cachedHtmlTemplate = fs.readFileSync(HTML_TEMPLATE_PATH, "utf8");
  }

  return cachedHtmlTemplate;
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtmlTemplate(data) {
  return loadHtmlTemplate().replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) =>
    escapeHtml(data[key]),
  );
}

function validateDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(value))) {
    throw new Error(`Invalid date key: ${value}`);
  }
}

function dateKeyToUtcDate(dateKey) {
  validateDateKey(dateKey);
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function getBusinessDateKey({
  baseDate = new Date(),
  timeZone = PERFORMANCE_CHECKIN_TIME_ZONE,
} = {}) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(baseDate)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDayOfWeek(dateKey) {
  return dateKeyToUtcDate(dateKey).getUTCDay();
}

function buildDateBeginQueryDates({ businessDateKey }) {
  const dates = [addDays(businessDateKey, -CHECKIN_DAY_OFFSET)];
  const dayOfWeek = getDayOfWeek(businessDateKey);

  if (dayOfWeek === 5) {
    dates.push(addDays(businessDateKey, 1 - CHECKIN_DAY_OFFSET));
  } else if (dayOfWeek === 1) {
    dates.push(addDays(businessDateKey, -1 - CHECKIN_DAY_OFFSET));
  }

  return Array.from(new Set(dates));
}

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return {
    startMs,
    endMs: startMs + DAY_MS,
    targetDate: dateKey,
  };
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function hasClientCorporationOverride(placement) {
  return normalizeLower(placement?.clientCorporation?.customText16) === "yes";
}

function isDoNotContactStatus(value) {
  return normalizeLower(value) === DO_NOT_CONTACT_STATUS;
}

function getPerformanceCheckinMatchDetails(placement) {
  const ownerPager = normalizeString(placement?.owner?.pager || placement?.jobOrder?.owner?.pager);
  const clientContact = placement?.clientContact || placement?.billingClientContact || {};
  const clientContactStatus = normalizeLower(clientContact.status);
  const clientCorporationStatus = normalizeLower(placement?.clientCorporation?.status);
  const employmentType = normalizeLower(placement?.employmentType);
  const status = normalizeLower(placement?.status);
  const clientCorporationId = normalizeString(placement?.clientCorporation?.id);
  const dateBegin = Number(placement?.dateBegin || 0);
  const minDateBegin = dateKeyToUtcDate(STANDARD_CRITERIA_MIN_DATE_BEGIN).getTime();
  const clientCorporationOverride = hasClientCorporationOverride(placement);
  const contactComplianceChecks = {
    clientContactStatusAllowed: !isDoNotContactStatus(clientContactStatus),
    clientCorporationStatusAllowed: !isDoNotContactStatus(clientCorporationStatus),
  };
  const contactCompliance = Object.values(contactComplianceChecks).every(Boolean);
  const standardChecks = {
    ownerPagerIs500: ownerPager === "500",
    dateBeginOnOrAfterMinimum: dateBegin >= minDateBegin,
    employmentTypeAllowed: INCLUDED_EMPLOYMENT_TYPES.has(employmentType),
    clientCorporationAllowed: !EXCLUDED_CLIENT_CORPORATION_IDS.has(clientCorporationId),
    statusAllowed: !EXCLUDED_STATUS_VALUES.has(status),
  };
  const standardCriteria = Object.values(standardChecks).every(Boolean);

  return {
    matched: contactCompliance && (clientCorporationOverride || standardCriteria),
    clientCorporationOverride,
    contactCompliance,
    contactComplianceChecks,
    standardCriteria,
    standardChecks,
    values: {
      ownerPager: ownerPager || null,
      minimumDateBegin: STANDARD_CRITERIA_MIN_DATE_BEGIN,
      dateBegin: placement?.dateBegin ?? null,
      dateBeginFormatted: formatDateBegin(placement?.dateBegin) || null,
      employmentType: placement?.employmentType || null,
      status: placement?.status || null,
      clientContactStatus: clientContact.status || null,
      clientCorporationId: placement?.clientCorporation?.id ?? null,
      clientCorporationName: placement?.clientCorporation?.name || null,
      clientCorporationStatus: placement?.clientCorporation?.status || null,
      clientCorporationCustomText16: placement?.clientCorporation?.customText16 || null,
      excludedStatuses: Array.from(EXCLUDED_STATUS_VALUES),
      doNotContactStatus: DO_NOT_CONTACT_STATUS,
    },
    failedStandardChecks: Object.entries(standardChecks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    failedContactComplianceChecks: Object.entries(contactComplianceChecks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
  };
}

function matchesPerformanceCheckinPlacement(placement) {
  return getPerformanceCheckinMatchDetails(placement).matched;
}

function buildSkippedPlacementPreview({ placement, queryDateBegin, reason, matchDetails = null }) {
  return {
    placementId: placement?.id ?? null,
    queryDateBegin,
    reason,
    matchDetails,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || null,
      dateBegin: placement?.dateBegin ?? null,
      dateBeginFormatted: formatDateBegin(placement?.dateBegin) || null,
      owner: placement?.owner || null,
      candidate: placement?.candidate || null,
      clientContact: placement?.clientContact || placement?.billingClientContact || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
  };
}

function buildRecipientEnvelope({ placement }) {
  const clientContact = placement?.clientContact || placement?.billingClientContact || {};
  const toEmail = normalizeLower(clientContact.email);
  const ccEmail = normalizeLower(placement?.jobOrder?.owner?.reportToPerson?.email);
  const fromEmail = normalizeLower(placement?.jobOrder?.owner?.email);

  return {
    toEmail,
    ccEmails: ccEmail && ccEmail !== toEmail ? [ccEmail] : [],
    fromEmail,
    fromName: buildFullName(placement?.jobOrder?.owner),
    missingClientContactEmail: !toEmail,
    missingJobOrderOwnerEmail: !fromEmail,
  };
}

function buildEmailContent({ placement }) {
  const clientContact = placement?.clientContact || placement?.billingClientContact || {};
  const candidateName = buildFullName(placement?.candidate) || "the candidate";
  const clientFirstName = normalizeString(clientContact.firstName) || "there";
  const ownerName = buildFullName(placement?.jobOrder?.owner);
  const dateBegin = formatDateBegin(placement?.dateBegin);
  const subject = `${candidateName}'s Performance Check-in: Your Feedback Needed`;

  const text = [
    `Hi ${clientFirstName},`,
    "",
    `It's time for a 4-week check-in and a performance review of ${candidateName}, who started their assignment on ${dateBegin}.`,
    "",
    "Please suggest a good time and day for a meeting to discuss their progress. If you're not directly responsible for this person, please forward this email to the relevant person.",
    "",
    `[This is an automated message generated on behalf of ${ownerName}. You may reply to this email directly.]`,
    "",
    "Best regards,",
  ].join("\n");

  const html = renderHtmlTemplate({
    client_first_name: clientFirstName,
    candidate_name: candidateName,
    date_begin: dateBegin,
    job_order_owner_name: ownerName,
  });

  return {
    subject,
    text,
    html,
  };
}

function buildPerformanceCheckinTransmission({ placement }) {
  const recipientEnvelope = buildRecipientEnvelope({ placement });
  const content = buildEmailContent({ placement });
  const recipients = [
    {
      address: {
        email: recipientEnvelope.toEmail,
      },
    },
    ...recipientEnvelope.ccEmails.map((email) => ({
      address: {
        email,
        header_to: recipientEnvelope.toEmail,
      },
    })),
  ].filter((recipient) => normalizeString(recipient?.address?.email));

  return {
    content: {
      from: {
        email: recipientEnvelope.fromEmail,
        name: recipientEnvelope.fromName,
      },
      subject: content.subject,
      text: content.text,
      html: content.html,
      ...(recipientEnvelope.ccEmails.length > 0
        ? { headers: { CC: recipientEnvelope.ccEmails.join(", ") } }
        : {}),
    },
    recipients,
    recipientEnvelope,
  };
}

function buildPlacementReportRecord({
  placement,
  businessDateKey,
  queryDateBegin,
  recipientEnvelope,
  sparkPostPayload,
  sendLock,
}) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDateBegin,
    checkinDayOffset: CHECKIN_DAY_OFFSET,
    sendLock,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || null,
      dateBegin: placement?.dateBegin || null,
      owner: placement?.owner || null,
      candidate: placement?.candidate || null,
      clientContact: placement?.clientContact || placement?.billingClientContact || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
    recipient: {
      toEmail: recipientEnvelope.toEmail || null,
      ccEmails: recipientEnvelope.ccEmails,
      fromEmail: recipientEnvelope.fromEmail || null,
      fromName: recipientEnvelope.fromName || null,
      missingClientContactEmail: recipientEnvelope.missingClientContactEmail,
      missingJobOrderOwnerEmail: recipientEnvelope.missingJobOrderOwnerEmail,
    },
    sparkPostPayload,
  };
}

module.exports = {
  CHECKIN_DAY_OFFSET,
  PERFORMANCE_CHECKIN_TIME_ZONE,
  SKIPPED_PREVIEW_LIMIT,
  buildDateBeginQueryDates,
  buildPerformanceCheckinTransmission,
  buildPlacementReportRecord,
  buildSkippedPlacementPreview,
  buildUtcDayWindowFromDateKey,
  getBusinessDateKey,
  getPerformanceCheckinMatchDetails,
  matchesPerformanceCheckinPlacement,
  renderHtmlTemplate,
};
