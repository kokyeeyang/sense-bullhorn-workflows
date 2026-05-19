const fs = require("node:fs");
const path = require("node:path");

const {
  buildTrackingPartitionKey,
  buildTrackingRowKey,
} = require("../stores/workflowSurveyTrackingStore");
const { buildFullName, normalizeString } = require("./placementStartReminderUtils");
const { buildWorkflowSurveyToken, normalizeLower } = require("./workflowSurveyUtils");

const WORKFLOW_NAME = "us-client-extension-notification-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const SKIPPED_PREVIEW_LIMIT = 25;
const EXTENSION_DAY_OFFSET = 42;
const SEND_HOUR = 8;
const SURVEY_QUESTION_ID = "us-client-extension-confirmation";
const SURVEY_QUESTION_TEXT = "Please can you confirm if you are looking to extend?";
const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "us-client-extension-notification.html",
);

const OWNER_DEPARTMENT_PREFIXES = [
  "houston",
  "hou - contract o&g",
  "hou - contract renewables",
  "hou - perm renewables",
  "hou - contract",
  "hou - contract craft",
  "hou - perm built",
  "denver",
  "den - contract renewables",
  "den - perm renewables",
  "den - perm p&u",
  "den - sos",
  "den - contract o&g",
  "den - perm o&g",
  "chi - contract renewables",
  "chi - contract power",
  "chi - perm renewables",
];
const ALLOWED_EMPLOYMENT_TYPES = new Set(["contract", "margin only", "marginonly"]);
const ALLOWED_STATUSES = new Set(["qc approved", "approved"]);
const EXCLUDED_CLIENT_CORPORATION_IDS = new Set(["12949", "7340"]);

let cachedTemplate = null;

function loadTemplate() {
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(TEMPLATE_PATH, "utf8");
  }

  return cachedTemplate;
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTemplate(data) {
  return loadTemplate().replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) =>
    key === "survey_buttons" ? data[key] || "" : escapeHtml(data[key]),
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

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return {
    startMs,
    endMs: startMs + DAY_MS,
    targetDate: dateKey,
  };
}

function getDayOfWeek(dateKey) {
  return dateKeyToUtcDate(dateKey).getUTCDay();
}

function buildDateEndQueryDates({ businessDateKey }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  const dates = [addDays(businessDateKey, EXTENSION_DAY_OFFSET)];

  if (dayOfWeek === 5) {
    dates.push(addDays(businessDateKey, EXTENSION_DAY_OFFSET + 1));
  } else if (dayOfWeek === 1) {
    dates.push(addDays(businessDateKey, EXTENSION_DAY_OFFSET - 1));
  }

  return Array.from(new Set(dates));
}

function buildRuleExecutionPlan({ businessDateKey, businessHour, force = false }) {
  const timedRuleDue = force || Number(businessHour) === SEND_HOUR;
  return {
    ruleKey: "client-extension-six-weeks",
    timedRuleDue,
    expectedPacificHour: SEND_HOUR,
    businessHour: Number(businessHour),
    queryDateEndDates: timedRuleDue ? buildDateEndQueryDates({ businessDateKey }) : [],
    skippedReason: timedRuleDue ? null : "outside-send-hour",
  };
}

function getOwner(placement) {
  return placement?.owner || placement?.jobOrder?.owner || {};
}

function getClientContact(placement) {
  return placement?.clientContact || placement?.billingClientContact || {};
}

function getEmploymentType(placement) {
  return normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
}

function getOwnerDepartment(placement) {
  return normalizeLower(getOwner(placement)?.primaryDepartment?.name);
}

function getMatchDetails(placement) {
  const ownerDepartment = getOwnerDepartment(placement);
  const employmentType = getEmploymentType(placement);
  const status = normalizeLower(placement?.status);
  const clientCorporationId = normalizeString(placement?.clientCorporation?.id);
  const checks = {
    ownerDepartmentAllowed: OWNER_DEPARTMENT_PREFIXES.some((prefix) =>
      ownerDepartment.startsWith(normalizeLower(prefix)),
    ),
    employmentTypeAllowed: ALLOWED_EMPLOYMENT_TYPES.has(employmentType),
    statusAllowed: ALLOWED_STATUSES.has(status),
    clientCorporationAllowed: !EXCLUDED_CLIENT_CORPORATION_IDS.has(clientCorporationId),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      ownerDepartment: getOwner(placement)?.primaryDepartment?.name || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      status: placement?.status || null,
      clientCorporationId: placement?.clientCorporation?.id ?? null,
    },
    expected: {
      ownerDepartmentStartsWith: OWNER_DEPARTMENT_PREFIXES,
      employmentTypes: Array.from(ALLOWED_EMPLOYMENT_TYPES),
      statuses: Array.from(ALLOWED_STATUSES),
      excludedClientCorporationIds: Array.from(EXCLUDED_CLIENT_CORPORATION_IDS),
    },
  };
}

function buildSurveyKey({ placement }) {
  return [
    WORKFLOW_NAME,
    placement?.id ?? "unknown",
    "client-extension-six-weeks",
    normalizeLower(getClientContact(placement)?.email),
  ].join("|");
}

function buildSurveyButtonHtml(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;margin:0 8px 12px 0;padding:10px 18px;background:#5630d3;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">${escapeHtml(label)}</a>`;
}

function buildSurveyUrl({ placement, config, surveyKey, answer, tracking }) {
  const baseUrl = normalizeString(config.WORKFLOW_SURVEY_RESPONSE_BASE_URL);
  if (!baseUrl) {
    return "";
  }

  const owner = getOwner(placement);
  const token = buildWorkflowSurveyToken({
    secret: config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET,
    payload: {
      workflowName: WORKFLOW_NAME,
      placementId: placement?.id ?? null,
      candidateId: placement?.candidate?.id ?? null,
      ownerId: owner?.id ?? null,
      ownerEmail: normalizeLower(owner?.email),
      recipientEmail: normalizeLower(getClientContact(placement)?.email),
      questionId: SURVEY_QUESTION_ID,
      questionText: SURVEY_QUESTION_TEXT,
      answer,
      issuedAt: tracking.tokenIssuedAt,
      surveyKey,
      trackingPartitionKey: tracking.partitionKey,
      trackingRowKey: tracking.rowKey,
      metadata: {
        ruleKey: "client-extension-six-weeks",
        recipientType: "client-contact",
      },
    },
  });
  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("answer", answer);
  return url.toString();
}

function buildTrackingRecord({ placement, businessDateKey, surveyKey, tokenIssuedAt }) {
  const clientContact = getClientContact(placement);
  const owner = getOwner(placement);
  const reminderDueDate = businessDateKey;
  const partitionKey = buildTrackingPartitionKey({ workflowName: WORKFLOW_NAME, reminderDueDate });
  const rowKey = buildTrackingRowKey({ reminderDueDate, surveyKey });

  return {
    partitionKey,
    rowKey,
    workflowName: WORKFLOW_NAME,
    surveyKey,
    ruleKey: "client-extension-six-weeks",
    sendType: "initial",
    recipientType: "client-contact",
    recipientEmail: normalizeLower(clientContact?.email),
    recipientFirstName: normalizeString(clientContact?.firstName),
    candidateId: placement?.candidate?.id ?? null,
    candidateName: buildFullName(placement?.candidate),
    clientContactId: clientContact?.id ?? null,
    clientContactName: buildFullName(clientContact),
    placementId: placement?.id ?? null,
    clientCorporationId: placement?.clientCorporation?.id ?? null,
    clientCorporationName: normalizeString(placement?.clientCorporation?.name),
    employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || "",
    currentPlacementStatus: placement?.status || "",
    businessDate: businessDateKey,
    initialSentAt: new Date().toISOString(),
    initialSentDate: businessDateKey,
    reminderDueDate,
    reminderSentAt: "",
    respondedAt: "",
    responseAnswer: "",
    trackingStatus: "pending",
    tokenIssuedAt,
    context: {
      dateEnd: placement?.dateEnd ?? null,
      ownerEmail: normalizeLower(owner?.email),
      ownerDepartment: owner?.primaryDepartment?.name || "",
    },
    metadata: {
      recipientType: "client-contact",
      offsetDays: EXTENSION_DAY_OFFSET,
    },
    runDate: businessDateKey,
  };
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

function buildTransmission({ placement, config, businessDateKey }) {
  const surveyKey = buildSurveyKey({ placement });
  const tokenIssuedAt = new Date().toISOString();
  const tracking = buildTrackingRecord({ placement, businessDateKey, surveyKey, tokenIssuedAt });
  const surveyUrls = {
    yes: buildSurveyUrl({ placement, config, surveyKey, answer: "yes", tracking }),
    no: buildSurveyUrl({ placement, config, surveyKey, answer: "no", tracking }),
  };
  const owner = getOwner(placement);
  const clientContact = getClientContact(placement);
  const html = renderTemplate({
    client_first_name: normalizeString(clientContact.firstName) || "there",
    candidate_name: buildFullName(placement?.candidate) || "your contractor",
    survey_buttons: `${buildSurveyButtonHtml(surveyUrls.yes, "Yes")}${buildSurveyButtonHtml(surveyUrls.no, "No")}`,
  });
  const ownerEmail = normalizeLower(owner?.email);
  const toEmail = tracking.recipientEmail;

  return {
    content: {
      from: {
        name: buildFullName(owner) || "Spencer Ogden",
        email: ownerEmail,
      },
      subject: "Your Spencer Ogden contractor is due to finish in 6 weeks",
      text: htmlToText(html),
      html,
      ...(ownerEmail ? { headers: { BCC: ownerEmail } } : {}),
    },
    recipients: [
      ...(toEmail ? [{ address: { email: toEmail } }] : []),
      ...(ownerEmail && ownerEmail !== toEmail
        ? [{ address: { email: ownerEmail, header_to: toEmail } }]
        : []),
    ],
    tracking,
    audit: {
      workflowName: WORKFLOW_NAME,
      sendType: "initial",
      ruleKey: "client-extension-six-weeks",
      recipientType: "client-contact",
      recipientEmail: toEmail,
      recipientFirstName: tracking.recipientFirstName,
      placementId: placement?.id ?? null,
      candidateId: placement?.candidate?.id ?? null,
      clientContactId: tracking.clientContactId ?? null,
      clientCorporationId: placement?.clientCorporation?.id ?? null,
      ownerId: owner?.id ?? null,
      ownerEmail,
      surveyKey,
      businessDate: businessDateKey,
      runDate: businessDateKey,
      context: tracking.context,
      metadata: tracking.metadata,
    },
    recipientEnvelope: {
      toEmail,
      bccEmail: ownerEmail,
      missingToEmail: !toEmail,
      missingFromEmail: !ownerEmail,
    },
  };
}

function buildReportItem({
  placement,
  businessDateKey,
  queryDateEnd,
  reason = null,
  matchDetails = null,
  recipientEnvelope = null,
  sparkPostPayload = null,
  sendLock = null,
}) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDateEnd,
    reason,
    matchDetails,
    sendLock,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      dateEnd: placement?.dateEnd ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      owner: getOwner(placement),
      candidate: placement?.candidate || null,
      clientContact: getClientContact(placement),
      clientCorporation: placement?.clientCorporation || null,
    },
    recipient: recipientEnvelope,
    sparkPostPayload,
  };
}

module.exports = {
  EXTENSION_DAY_OFFSET,
  QUERY_COUNT_DEFAULT,
  SEND_HOUR,
  SKIPPED_PREVIEW_LIMIT,
  SURVEY_QUESTION_ID,
  SURVEY_QUESTION_TEXT,
  TIME_ZONE,
  WORKFLOW_NAME,
  buildDateEndQueryDates,
  buildReportItem,
  buildRuleExecutionPlan,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
};
