const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, normalizeString } = require("./placementStartReminderUtils");
const { buildSurveyGeoFields } = require("./surveyGeoUtils");
const { buildWorkflowSurveyToken, normalizeLower } = require("./workflowSurveyUtils");

const WORKFLOW_NAME = "vestas-po-sync";
const TIME_ZONE = "America/Los_Angeles";
const SEND_AT_PACIFIC_HOUR = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const VESTAS_CLIENT_CORPORATION_ID = 10752;
const SURVEY_QUESTION_ID = "vestas-po-turnaround-time";
const SURVEY_QUESTION_TEXT = "Please confirm the turnaround time for the purchase order";
const SURVEY_OPTIONS = [
  { value: "0-2-days", label: "0-2 days" },
  { value: "4-5-days", label: "4-5 days" },
  { value: "7-8-days", label: "7-8 days" },
  { value: "2-weeks", label: "2 weeks" },
];
const DEFAULT_CC_EMAILS = ["usainvoices@spencer-ogden.com", "mindy.prefling@spencer-ogden.com"];
const ATTACHMENT_PATH = "attachments/Vestas TOB.pdf";
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const TEMPLATE_PATH = "vestas-po.html";

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;

  return {
    dateKey,
    dayOfWeek: getDayOfWeek(dateKey),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
  };
}

function buildDateAddedQueryDates({ businessDateKey }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [];
  }
  if (dayOfWeek === 1) {
    return [addDays(businessDateKey, -2), addDays(businessDateKey, -1), businessDateKey];
  }
  return [businessDateKey];
}

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return {
    startMs,
    endMs: startMs + DAY_MS,
    targetDate: dateKey,
  };
}

function isTimedRuleDue({ businessHour, dayOfWeek, force = false }) {
  return force || (businessHour === SEND_AT_PACIFIC_HOUR && dayOfWeek >= 1 && dayOfWeek <= 5);
}

function formatMoney(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return "";
  }

  const numberValue = Number(raw);
  if (!Number.isFinite(numberValue)) {
    return raw;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(numberValue) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numberValue);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function getClientContact(placement) {
  return placement?.clientContact || placement?.billingClientContact || {};
}

function getOwner(placement) {
  return placement?.owner || placement?.jobOrder?.owner || {};
}

function matchesPlacement(placement) {
  return Number(placement?.clientCorporation?.id || 0) === VESTAS_CLIENT_CORPORATION_ID;
}

function getMatchDetails(placement) {
  const clientCorporationId = Number(placement?.clientCorporation?.id || 0);
  const clientCorporationMatches = clientCorporationId === VESTAS_CLIENT_CORPORATION_ID;

  return {
    matched: clientCorporationMatches,
    checks: {
      clientCorporationMatches,
    },
    actual: {
      clientCorporationId: clientCorporationId || null,
      clientCorporationName: placement?.clientCorporation?.name || null,
    },
    expected: {
      clientCorporationId: VESTAS_CLIENT_CORPORATION_ID,
    },
  };
}

function loadTemplate() {
  return fs.readFileSync(path.join(TEMPLATE_DIR, TEMPLATE_PATH), "utf8");
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
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

function buildSurveyUrl({ placement, option, config }) {
  const baseUrl = normalizeString(config.WORKFLOW_SURVEY_RESPONSE_BASE_URL);
  if (!baseUrl) {
    return "";
  }

  const owner = getOwner(placement);
  const clientContact = getClientContact(placement);
  const geo = buildSurveyGeoFields(placement);
  const token = buildWorkflowSurveyToken({
    secret: config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET,
    payload: {
      workflowName: WORKFLOW_NAME,
      placementId: placement?.id ?? null,
      candidateId: placement?.candidate?.id ?? null,
      ownerId: owner?.id ?? null,
      ownerEmail: normalizeLower(owner?.email),
      recipientEmail: normalizeLower(owner?.email),
      questionId: SURVEY_QUESTION_ID,
      questionText: SURVEY_QUESTION_TEXT,
      answer: option.value,
      issuedAt: new Date().toISOString(),
      surveyKey: `${WORKFLOW_NAME}|${placement?.id ?? "unknown"}|${SURVEY_QUESTION_ID}`,
      metadata: {
        answerLabel: option.label,
        clientContactId: clientContact?.id ?? null,
        clientContactEmail: normalizeLower(clientContact?.email),
        clientCorporationId: placement?.clientCorporation?.id ?? null,
        ...geo,
      },
    },
  });

  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("answer", option.value);
  return url.toString();
}

function buildSurveySectionHtml({ placement, config }) {
  const buttons = SURVEY_OPTIONS.map((option) => {
    const url = buildSurveyUrl({ placement, option, config });
    if (!url) {
      return null;
    }

    return [
      '<tr>',
      '  <td style="padding:0 0 8px;">',
      `    <a href="${escapeHtml(url)}" style="display:inline-block; min-width:120px; padding:10px 16px; background:#5630d3; color:#ffffff; text-decoration:none; border-radius:4px; font-size:15px; line-height:20px; font-weight:700; text-align:center;">${escapeHtml(option.label)}</a>`,
      "  </td>",
      "</tr>",
    ].join("\n");
  }).filter(Boolean);

  if (buttons.length === 0) {
    return `
      <p style="margin:0 0 10px; font-size:16px; line-height:24px; font-weight:700;">${escapeHtml(SURVEY_QUESTION_TEXT)}</p>
      <p style="margin:0 0 18px; font-size:16px; line-height:24px;">Please use the workflow survey response link when it is configured.</p>
    `;
  }

  return `
    <p style="margin:0 0 10px; font-size:16px; line-height:24px; font-weight:700;">${escapeHtml(SURVEY_QUESTION_TEXT)}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;">
      ${buttons.join("\n")}
    </table>
  `;
}

function buildEmailContent({ placement, config }) {
  const clientContact = getClientContact(placement);
  const owner = getOwner(placement);
  const candidateName = buildFullName(placement?.candidate);
  const clientContactName = buildFullName(clientContact);
  const surveySectionHtml = buildSurveySectionHtml({ placement, config });
  const html = renderTemplate(loadTemplate(), {
    client_contact_first_name: escapeHtml(clientContact?.firstName || "there"),
    client_contact_name: escapeHtml(clientContactName),
    candidate_name: escapeHtml(candidateName),
    job_title: escapeHtml(placement?.jobOrder?.title),
    placement_id: escapeHtml(placement?.id),
    start_date: escapeHtml(formatDate(placement?.dateBegin)),
    salary: escapeHtml(formatMoney(placement?.salary)),
    flat_fee: escapeHtml(formatMoney(placement?.flatFee)),
    survey_section_html: surveySectionHtml,
  });

  const text = [
    `Hi ${normalizeString(clientContact?.firstName) || "there"},`,
    "",
    "Thank you for choosing to work with Spencer Ogden. We are very excited that our candidate was selected to join your company.",
    "",
    "We look forward to receiving your purchase order for the following engagement:",
    "",
    "Candidate Information",
    `Name: ${candidateName}`,
    `Job Title: ${normalizeString(placement?.jobOrder?.title)}`,
    `Manager: ${clientContactName}`,
    `Placement ID: ${normalizeString(placement?.id)}`,
    `Start Date: ${formatDate(placement?.dateBegin)}`,
    `Compensation: $ ${formatMoney(placement?.salary)}`,
    `Fee: $ ${formatMoney(placement?.flatFee)}`,
    "",
    "General Terms",
    "Fee Structure: 30%",
    "Minimum Fee: $20,000",
    "Payment Terms: 45 days",
    "Refund Scale from Terms: 0-30 days = 100%; 31-60 days = 75%; 61-90 days = 50%",
    "",
    SURVEY_QUESTION_TEXT,
    SURVEY_OPTIONS.map((option) => option.label).join(" / "),
    "",
    "We look forward to receiving the work order to ensure efficient processing of your invoice. If there is anything else we can provide to make processing easier, please do not hesitate to contact me.",
    "",
    "We would appreciate a reply to this email confirming when the PR is issued and again when the PO is issued.",
    "",
    "Regards,",
    "",
    "Mindy",
  ].join("\n");

  return {
    from: {
      name: "Spencer Ogden",
      email: "houseaccounts@spencer-ogden.com",
    },
    subject: `Purchase Order Request - Placement ${normalizeString(placement?.id)} - ${candidateName}`,
    text,
    html,
    attachments: [buildAttachment(ATTACHMENT_PATH)],
    headers: {
      CC: DEFAULT_CC_EMAILS.join(", "),
    },
    owner,
  };
}

function buildAttachment(filePath) {
  const resolvedPath = path.resolve(filePath);
  return {
    name: path.basename(resolvedPath),
    type: path.extname(resolvedPath).toLowerCase() === ".pdf" ? "application/pdf" : "application/octet-stream",
    data: fs.readFileSync(resolvedPath).toString("base64"),
  };
}

function uniqueEmails(values, { exclude = [] } = {}) {
  const excludeSet = new Set(exclude.map(normalizeLower).filter(Boolean));
  const seen = new Set();
  const emails = [];

  for (const value of values) {
    const email = normalizeLower(value);
    if (!email || seen.has(email) || excludeSet.has(email)) {
      continue;
    }
    seen.add(email);
    emails.push(email);
  }

  return emails;
}

function buildTransmission({ placement, config }) {
  const content = buildEmailContent({ placement, config });
  const toEmail = normalizeLower(content.owner?.email);
  const ccEmails = uniqueEmails(DEFAULT_CC_EMAILS, { exclude: [toEmail] });
  const substitutionData = {
    placement_id: normalizeString(placement?.id),
    candidate_name: buildFullName(placement?.candidate),
    client_contact_name: buildFullName(getClientContact(placement)),
    owner_email: toEmail,
  };
  const recipients = [
    {
      address: {
        email: toEmail,
      },
      substitution_data: substitutionData,
    },
    ...ccEmails.map((email) => ({
      address: {
        email,
        header_to: toEmail,
      },
      substitution_data: substitutionData,
    })),
  ].filter((recipient) => normalizeString(recipient?.address?.email));

  return {
    content: {
      from: content.from,
      subject: content.subject,
      text: content.text,
      html: content.html,
      attachments: content.attachments,
      headers: ccEmails.length ? { CC: ccEmails.join(", ") } : undefined,
    },
    recipients,
    recipientEnvelope: {
      toEmail,
      ccEmails,
      missingOwnerEmail: !toEmail,
    },
    attachmentPaths: [path.resolve(ATTACHMENT_PATH)],
  };
}

function buildPlacementReportRecord({ placement, queryDateAdded, businessDateKey, recipientEnvelope, sparkPostPayload, sendLock }) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDateAdded,
    placement: {
      id: placement?.id ?? null,
      dateAdded: placement?.dateAdded || null,
      dateBegin: placement?.dateBegin || null,
      salary: placement?.salary ?? null,
      flatFee: placement?.flatFee ?? null,
      candidate: placement?.candidate || null,
      clientContact: getClientContact(placement),
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
      owner: getOwner(placement),
    },
    recipient: recipientEnvelope,
    attachmentPaths: [path.resolve(ATTACHMENT_PATH)],
    sendLock,
    sparkPostPayload,
  };
}

module.exports = {
  ATTACHMENT_PATH,
  DEFAULT_CC_EMAILS,
  QUERY_COUNT_DEFAULT,
  SEND_AT_PACIFIC_HOUR,
  SURVEY_OPTIONS,
  SURVEY_QUESTION_ID,
  SURVEY_QUESTION_TEXT,
  TIME_ZONE,
  VESTAS_CLIENT_CORPORATION_ID,
  WORKFLOW_NAME,
  buildDateAddedQueryDates,
  buildEmailContent,
  buildPlacementReportRecord,
  buildSurveySectionHtml,
  buildSurveyUrl,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  formatDate,
  formatMoney,
  getBusinessDateParts,
  getMatchDetails,
  htmlToText,
  isTimedRuleDue,
  matchesPlacement,
};
