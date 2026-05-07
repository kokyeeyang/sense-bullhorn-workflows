const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, formatDateBegin, normalizeString } = require("./placementStartReminderUtils");
const { getPlacementWorkState } = require("./harassmentTrainingUtils");
const {
  buildWorkflowSurveyToken,
  normalizeLower,
} = require("./workflowSurveyUtils");

const WORKFLOW_NAME = "start-date-approval-reminder-sync";
const START_DATE_APPROVAL_TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DATE_BEGIN = "2022-12-01";
const SEND_HOUR = 0;
const START_DATE_APPROVAL_QUESTION_ID = "attached-start-date-confirmation";
const START_DATE_APPROVAL_QUESTION_TEXT =
  "Have you attached your candidates/clients confirmation of start date to your placement?";
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "start-date-approval-reminder.html");
const SKIPPED_PREVIEW_LIMIT = 25;
const REGION_RULES = [
  {
    key: "americas",
    label: "Americas",
    ownerPagerIn: new Set(["500"]),
    requiresSurvey: true,
  },
  {
    key: "apac",
    label: "APAC",
    ownerPagerIn: new Set(["100", "175", "400", "450", "460", "470"]),
    requiresSurvey: false,
  },
  {
    key: "emea",
    label: "EMEA",
    ownerPagerIn: new Set(["1", "125"]),
    requiresSurvey: false,
  },
];
const STAGES = [
  {
    key: "day-2",
    daysAfterDateBegin: 2,
    subjectPrefix: "2 days after",
  },
  {
    key: "day-10",
    daysAfterDateBegin: 10,
    subjectPrefix: "10 days after",
  },
];

let cachedHtmlTemplate = null;

function loadHtmlTemplate() {
  if (!cachedHtmlTemplate) {
    cachedHtmlTemplate = fs.readFileSync(TEMPLATE_PATH, "utf8");
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
  return loadHtmlTemplate().replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
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

function getBusinessDateParts({ baseDate = new Date(), timeZone = START_DATE_APPROVAL_TIME_ZONE } = {}) {
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
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
  };
}

function getDayOfWeek(dateKey) {
  return dateKeyToUtcDate(dateKey).getUTCDay();
}

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return {
    startMs,
    endMs: startMs + DAY_MS,
    targetDate: dateKey,
  };
}

function buildStageQueryDates({ businessDateKey, stage }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [];
  }

  const dates = [addDays(businessDateKey, -stage.daysAfterDateBegin)];

  if (dayOfWeek === 5) {
    dates.push(addDays(businessDateKey, 1 - stage.daysAfterDateBegin));
  } else if (dayOfWeek === 1) {
    dates.unshift(addDays(businessDateKey, -1 - stage.daysAfterDateBegin));
  }

  return Array.from(new Set(dates));
}

function buildStageQueryPlan({ businessDateKey }) {
  return STAGES.map((stage) => ({
    ...stage,
    queryDateBeginDates: buildStageQueryDates({ businessDateKey, stage }),
  }));
}

function isTimedRuleDue({ businessHour, force = false }) {
  return force || Number(businessHour) === SEND_HOUR;
}

function getOwner(placement) {
  return placement?.owner || {};
}

function getJobOrderOwner(placement) {
  return placement?.jobOrder?.owner || {};
}

function getClientCompanyName(placement) {
  return normalizeString(placement?.clientContact?.companyName) ||
    normalizeString(placement?.clientCorporation?.name) ||
    "";
}

function findRegionRule(placement) {
  const ownerPager = normalizeString(getOwner(placement)?.pager);
  return REGION_RULES.find((rule) => rule.ownerPagerIn.has(ownerPager)) || null;
}

function getMatchDetails(placement) {
  const status = normalizeLower(placement?.status);
  const dateBegin = Number(placement?.dateBegin || 0);
  const ownerPager = normalizeString(getOwner(placement)?.pager);
  const minDateBegin = dateKeyToUtcDate(MIN_DATE_BEGIN).getTime();
  const regionRule = findRegionRule(placement);
  const checks = {
    dateBeginOnOrAfterMinimum: dateBegin >= minDateBegin,
    statusAllowed: new Set(["qc approved", "pre-hire"]).has(status),
    ownerPagerAllowed: Boolean(regionRule),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    region: regionRule ? regionRule.label : null,
    checks,
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    actual: {
      dateBegin: placement?.dateBegin ?? null,
      dateBeginFormatted: formatDateBegin(placement?.dateBegin) || null,
      status: placement?.status || null,
      ownerPager: ownerPager || null,
      workState: getPlacementWorkState(placement) || null,
    },
    expected: {
      minimumDateBegin: MIN_DATE_BEGIN,
      statuses: ["qc approved", "pre-hire"],
      ownerPagers: REGION_RULES.flatMap((rule) => Array.from(rule.ownerPagerIn)),
    },
  };
}

function matchesPlacement(placement) {
  return getMatchDetails(placement).matched;
}

function buildSubject({ placement, stage }) {
  return `${stage.subjectPrefix} Placement Start Date Approval Status Reminder ${normalizeString(placement?.id)} - ${buildFullName(placement?.candidate)}`;
}

function buildSurveyUrl({ placement, stage, answer, config }) {
  const baseUrl = normalizeString(config.WORKFLOW_SURVEY_RESPONSE_BASE_URL);
  if (!baseUrl) {
    return "";
  }

  const token = buildWorkflowSurveyToken({
    secret: config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET,
    payload: {
      workflowName: WORKFLOW_NAME,
      placementId: placement?.id ?? null,
      candidateId: placement?.candidate?.id ?? null,
      ownerId: getOwner(placement)?.id ?? null,
      ownerEmail: normalizeString(getOwner(placement)?.email).toLowerCase(),
      questionId: START_DATE_APPROVAL_QUESTION_ID,
      questionText: START_DATE_APPROVAL_QUESTION_TEXT,
      answer,
      issuedAt: new Date().toISOString(),
      metadata: {
        stageKey: stage.key,
        stageDaysAfterDateBegin: stage.daysAfterDateBegin,
        region: findRegionRule(placement)?.label || null,
      },
    },
  });

  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("answer", answer);
  return url.toString();
}

function buildSurveySectionHtml({ placement, stage, config }) {
  const yesUrl = buildSurveyUrl({ placement, stage, answer: "yes", config });
  const noUrl = buildSurveyUrl({ placement, stage, answer: "no", config });

  if (!yesUrl || !noUrl) {
    return `
      <p><strong>${escapeHtml(START_DATE_APPROVAL_QUESTION_TEXT)}</strong></p>
      <p>Please use the workflow survey response link when it is configured.</p>
    `;
  }

  return `
    <p><strong>${escapeHtml(START_DATE_APPROVAL_QUESTION_TEXT)}</strong></p>
    <p style="margin:16px 0;">
      <a href="${escapeHtml(yesUrl)}" style="display:inline-block;margin-right:12px;padding:10px 16px;background:#1f7a1f;color:#ffffff;text-decoration:none;border-radius:4px;">Yes</a>
      <a href="${escapeHtml(noUrl)}" style="display:inline-block;padding:10px 16px;background:#b42318;color:#ffffff;text-decoration:none;border-radius:4px;">No</a>
    </p>
  `;
}

function buildRecipientEnvelope({ placement }) {
  const owner = getOwner(placement);
  const toEmail = normalizeLower(owner?.email);
  const ccEmail = normalizeLower(getJobOrderOwner(placement)?.reportToPerson?.email);

  return {
    toEmail,
    ccEmails: ccEmail && ccEmail !== toEmail ? [ccEmail] : [],
    missingOwnerEmail: !toEmail,
  };
}

function buildEmailContent({ placement, stage, regionRule, config }) {
  const owner = getOwner(placement);
  const candidateName = buildFullName(placement?.candidate) || "the candidate";
  const surveySectionHtml = regionRule.requiresSurvey
    ? buildSurveySectionHtml({ placement, stage, config })
    : "";

  const html = renderHtmlTemplate({
    owner_first_name: escapeHtml(owner?.firstName || "there"),
    candidate_name: escapeHtml(candidateName),
    placement_id: escapeHtml(placement?.id),
    client_company_name: escapeHtml(getClientCompanyName(placement)),
    placement_status: escapeHtml(placement?.status),
    survey_section_html: surveySectionHtml,
  });

  const lines = [
    `Hi ${normalizeString(owner?.firstName) || "there"},`,
    "",
    `Your candidate ${candidateName}, placement number ${normalizeString(placement?.id)} who is currently working at ${getClientCompanyName(placement)} has started according to Bullhorn, but your approval status is still ${normalizeString(placement?.status)}. Please follow up with your CCS team to establish what documentation is needed for approval.`,
    "",
    "Please remember that placements that have not been approved, will not be invoiced and will have an impact on your commission.",
  ];

  if (regionRule.requiresSurvey) {
    lines.push("", START_DATE_APPROVAL_QUESTION_TEXT, "Yes / No");
  }

  lines.push("", "With Regards,", "", "Sales Operations Team");

  return {
    subject: buildSubject({ placement, stage }),
    text: lines.join("\n"),
    html,
  };
}

function buildTransmission({ placement, stage, regionRule, config }) {
  const recipientEnvelope = buildRecipientEnvelope({ placement });
  const content = buildEmailContent({ placement, stage, regionRule, config });
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
        name: "Sales Operations Team",
        email: "noreply@spencer-ogden.com",
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

function buildSkippedPlacementPreview({ placement, stage, queryDateBegin, reason, matchDetails = null }) {
  return {
    placementId: placement?.id ?? null,
    queryDateBegin,
    reason,
    stage: {
      key: stage.key,
      label: stage.subjectPrefix,
      daysAfterDateBegin: stage.daysAfterDateBegin,
    },
    matchDetails,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      dateBegin: placement?.dateBegin ?? null,
      dateBeginFormatted: formatDateBegin(placement?.dateBegin) || null,
      workState: getPlacementWorkState(placement) || null,
      owner: placement?.owner || null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
  };
}

function buildPlacementReportRecord({
  placement,
  stage,
  regionRule,
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
    region: regionRule.label,
    surveyRequired: regionRule.requiresSurvey,
    sendLock,
    stage: {
      key: stage.key,
      label: stage.subjectPrefix,
      daysAfterDateBegin: stage.daysAfterDateBegin,
    },
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      dateBegin: placement?.dateBegin || null,
      workState: getPlacementWorkState(placement) || null,
      owner: placement?.owner || null,
      candidate: placement?.candidate || null,
      clientContact: placement?.clientContact || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
    recipient: {
      toEmail: recipientEnvelope.toEmail || null,
      ccEmails: recipientEnvelope.ccEmails,
      missingOwnerEmail: recipientEnvelope.missingOwnerEmail,
    },
    sparkPostPayload,
  };
}

module.exports = {
  MIN_DATE_BEGIN,
  REGION_RULES,
  SEND_HOUR,
  SKIPPED_PREVIEW_LIMIT,
  STAGES,
  START_DATE_APPROVAL_QUESTION_ID,
  START_DATE_APPROVAL_QUESTION_TEXT,
  START_DATE_APPROVAL_TIME_ZONE,
  WORKFLOW_NAME,
  buildPlacementReportRecord,
  buildSkippedPlacementPreview,
  buildStageQueryPlan,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
  matchesPlacement,
};
