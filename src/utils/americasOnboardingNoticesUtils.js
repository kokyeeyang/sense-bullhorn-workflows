const fs = require("node:fs");
const path = require("node:path");

const { getPlacementCountry, getPlacementWorkState } = require("./harassmentTrainingUtils");
const { buildFullName, normalizeString } = require("./placementStartReminderUtils");
const { buildWorkflowSurveyToken, normalizeLower } = require("./workflowSurveyUtils");

const WORKFLOW_NAME = "americas-onboarding-notices-sync";
const AMERICAS_ONBOARDING_TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const SURVEY_QUESTION_ID = "reviewed-hero-act-document";
const SURVEY_QUESTION_TEXT = "Please confirm you have reviewed the attached document?";
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const SKIPPED_PREVIEW_LIMIT = 25;

const RULES = [
  {
    key: "colorado-healthy-families",
    source: "dateBegin",
    state: "colorado",
    country: null,
    minimumDateBegin: "2021-01-01",
    statusIn: new Set(["approved", "qc approved", "pre-hire"]),
    employmentType: "contract",
    weekendAdjust: true,
    sendAtPacificHour: 11,
    from: {
      name: "Spencer Ogden Onboarding",
      email: "onboarding@spencer-ogden.com",
    },
    to: "candidate.email",
    cc: [],
    subject: "Colorado Healthy Families and Workplace Act",
    templatePath: "americas-paid-leave-onboarding.html",
    noticeName: "Healthy Families and Workplaces Act",
    stateName: "Colorado",
    attachments: ["attachments/INFO #6A_ Paid Leave under the Healthy Families and Workplaces Act, through 12_31_20 (3).pdf"],
    requiresSurvey: false,
  },
  {
    key: "michigan-paid-medical-leave",
    source: "dateBegin",
    state: "michigan",
    country: null,
    minimumDateBegin: null,
    statusIn: new Set(["approved", "qc approved"]),
    employmentType: "contract",
    weekendAdjust: true,
    sendAtPacificHour: 11,
    from: {
      name: "Spencer Ogden Onboarding",
      email: "onboarding@spencer-ogden.com",
    },
    to: "candidate.email",
    cc: [],
    subject: "Michigan Paid Medical Leave Act",
    templatePath: "americas-paid-leave-onboarding.html",
    noticeName: "Paid Medical Leave Act",
    stateName: "Michigan",
    attachments: ["attachments/Paid Medical Leave Act Poster.pdf"],
    requiresSurvey: false,
  },
  {
    key: "new-york-city-hero-act",
    source: "dateBegin",
    state: "new york",
    country: "united states",
    minimumDateBegin: null,
    statusIn: new Set(["approved", "qc approved", "submitted"]),
    employmentType: "contract",
    weekendAdjust: false,
    sendAtPacificHour: 9,
    from: "candidateOwner",
    to: "candidate.email",
    cc: ["onboarding@spencer-ogden.com"],
    subject: "New York City - Hero Act",
    templatePath: "americas-new-york-city-hero-act.html",
    attachments: ["attachments/NY Hero Act 2021.pdf"],
    requiresSurvey: true,
  },
  {
    key: "new-york-city-commuter",
    source: "statusChange",
    state: "new york",
    country: null,
    minimumDateBegin: null,
    statusIn: null,
    newStatusIn: new Set(["qc approved"]),
    employmentType: "contract",
    weekendAdjust: true,
    delayDays: 1,
    from: "candidateOwner",
    to: "candidateOwner.email",
    cc: [],
    subject: "NY Placement - Evaluate for NYC Commuter Benefit",
    templatePath: "americas-new-york-city-commuter.html",
    attachments: [],
    requiresSurvey: false,
  },
];

const templateCache = new Map();

function parseConfiguredFields(value) {
  return normalizeString(value)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
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

function getDayOfWeek(dateKey) {
  return dateKeyToUtcDate(dateKey).getUTCDay();
}

function getBusinessDateParts({ baseDate = new Date(), timeZone = AMERICAS_ONBOARDING_TIME_ZONE } = {}) {
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

function buildSendDateKeysForWeekendAdjust({ businessDateKey, weekendAdjust }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (!weekendAdjust) {
    return [businessDateKey];
  }
  if (dayOfWeek === 5) {
    return [businessDateKey, addDays(businessDateKey, 1)];
  }
  if (dayOfWeek === 1) {
    return [addDays(businessDateKey, -1), businessDateKey];
  }
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [];
  }
  return [businessDateKey];
}

function buildDateBeginQueryDates({ rule, businessDateKey }) {
  return buildSendDateKeysForWeekendAdjust({
    businessDateKey,
    weekendAdjust: rule.weekendAdjust,
  });
}

function buildDelayedStatusChangeDateKeys({ businessDateKey, delayDays = 1, weekendAdjust }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (!weekendAdjust) {
    return [addDays(businessDateKey, -delayDays)];
  }
  if (dayOfWeek === 1) {
    return [addDays(businessDateKey, -3), addDays(businessDateKey, -2), addDays(businessDateKey, -1)];
  }
  if (dayOfWeek === 5) {
    return [addDays(businessDateKey, -1), businessDateKey];
  }
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [];
  }
  return [addDays(businessDateKey, -delayDays)];
}

function buildRuleExecutionPlan({ rule, businessDateKey, businessHour, force = false }) {
  const timedRuleDue = isTimedRuleDue({ rule, businessHour, force });
  return {
    ruleKey: rule.key,
    source: rule.source,
    timedRuleDue,
    expectedPacificHour: rule.sendAtPacificHour === undefined ? null : Number(rule.sendAtPacificHour),
    businessHour: Number(businessHour),
    weekendAdjust: Boolean(rule.weekendAdjust),
    queryDateBeginDates:
      timedRuleDue && rule.source === "dateBegin" ? buildDateBeginQueryDates({ rule, businessDateKey }) : [],
    queryStatusChangeDates:
      timedRuleDue && rule.source === "statusChange"
        ? buildDelayedStatusChangeDateKeys({
            businessDateKey,
            delayDays: rule.delayDays || 1,
            weekendAdjust: rule.weekendAdjust,
          })
        : [],
    skippedReason: timedRuleDue ? null : "outside-send-hour",
  };
}

function isTimedRuleDue({ rule, businessHour, force = false }) {
  return force || rule.sendAtPacificHour === undefined || Number(rule.sendAtPacificHour) === Number(businessHour);
}

function getCandidateOwner(placement) {
  return placement?.candidate?.owner || {};
}

function resolveFrom(placement, fromConfig) {
  if (fromConfig === "candidateOwner") {
    const owner = getCandidateOwner(placement);
    return {
      name: buildFullName(owner) || "Spencer Ogden",
      email: normalizeLower(owner?.email),
    };
  }

  return fromConfig;
}

function resolvePathValue(placement, selector) {
  const candidateOwner = getCandidateOwner(placement);
  const values = {
    "candidate.email": placement?.candidate?.email,
    "candidateOwner.email": candidateOwner?.email,
    "candidateOwner.name": buildFullName(candidateOwner),
  };
  return values[selector];
}

function resolveEmailValue(placement, value) {
  const normalized = normalizeString(value);
  if (normalized.includes("@")) {
    return normalizeLower(normalized);
  }
  return normalizeLower(resolvePathValue(placement, normalized));
}

function uniqueEmails(values, { exclude = [] } = {}) {
  const excludeSet = new Set(exclude.map((value) => normalizeLower(value)).filter(Boolean));
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

function loadHtmlTemplate(templatePath) {
  const resolvedPath = path.join(TEMPLATE_DIR, templatePath);
  if (!templateCache.has(resolvedPath)) {
    templateCache.set(resolvedPath, fs.readFileSync(resolvedPath, "utf8"));
  }
  return templateCache.get(resolvedPath);
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

function renderHtmlTemplate(templatePath, data) {
  return loadHtmlTemplate(templatePath).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
}

function getMatchDetails(placement, rule, options = {}) {
  const status = normalizeLower(placement?.status);
  const state = normalizeLower(getPlacementWorkState(placement));
  const country = normalizeLower(getPlacementCountry(placement));
  const employmentType = normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
  const dateBegin = Number(placement?.dateBegin || 0);
  const minimumDateBegin = rule.minimumDateBegin ? dateKeyToUtcDate(rule.minimumDateBegin).getTime() : null;
  const acceptedStatuses = new Set([
    ...Array.from(rule.statusIn || []),
    ...parseConfiguredFields(options.extraStatuses).map((value) => normalizeLower(value)),
  ]);
  const change = options.change || null;
  const newValue = normalizeLower(change?.newValue);
  const checks = {
    stateMatches: state === rule.state,
    countryMatches: !rule.country || country === rule.country,
    employmentTypeMatches: employmentType === rule.employmentType,
    statusMatches: rule.statusIn ? acceptedStatuses.has(status) : true,
    dateBeginMatches: minimumDateBegin === null || dateBegin >= minimumDateBegin,
    newStatusMatches: rule.newStatusIn ? rule.newStatusIn.has(newValue) : true,
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      state: getPlacementWorkState(placement) || null,
      country: getPlacementCountry(placement) || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      status: placement?.status || null,
      dateBegin: placement?.dateBegin ?? null,
      newValue: change?.newValue ?? null,
    },
    expected: {
      state: rule.state,
      country: rule.country,
      employmentType: rule.employmentType,
      statusIn: rule.statusIn ? Array.from(acceptedStatuses) : null,
      newStatusIn: rule.newStatusIn ? Array.from(rule.newStatusIn) : null,
      minimumDateBegin: rule.minimumDateBegin,
    },
  };
}

function buildSurveyUrl({ placement, answer, config }) {
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
      ownerId: getCandidateOwner(placement)?.id ?? null,
      ownerEmail: normalizeLower(getCandidateOwner(placement)?.email),
      questionId: SURVEY_QUESTION_ID,
      questionText: SURVEY_QUESTION_TEXT,
      answer,
      issuedAt: new Date().toISOString(),
      metadata: {
        ruleKey: "new-york-city-hero-act",
      },
    },
  });

  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("answer", answer);
  return url.toString();
}

function buildSurveySectionHtml({ placement, config }) {
  return renderHtmlTemplate("americas-new-york-city-hero-act.html", {
    candidate_first_name: normalizeString(placement?.candidate?.firstName),
    client_company_name: normalizeString(placement?.clientCorporation?.name),
    question_text: SURVEY_QUESTION_TEXT,
    survey_url_yes: buildSurveyUrl({ placement, answer: "yes", config }),
    survey_url_no: buildSurveyUrl({ placement, answer: "no", config }),
    candidate_owner_name: buildFullName(getCandidateOwner(placement)),
  });
}

function buildTransmission({ placement, rule, config, attachments = [] }) {
  const toEmail = resolveEmailValue(placement, rule.to);
  const ccEmails = uniqueEmails(rule.cc.map((value) => resolveEmailValue(placement, value)), {
    exclude: [toEmail],
  });
  const from = resolveFrom(placement, rule.from);
  const candidateFirstName = normalizeString(placement?.candidate?.firstName);
  const clientCompanyName = normalizeString(placement?.clientCorporation?.name);

  const html = rule.requiresSurvey
    ? buildSurveySectionHtml({ placement, config })
    : rule.key === "new-york-city-commuter"
      ? renderHtmlTemplate(rule.templatePath, {
          candidate_first_name: candidateFirstName,
          candidate_last_name: normalizeString(placement?.candidate?.lastName),
          placement_id: normalizeString(placement?.id),
        })
    : renderHtmlTemplate(rule.templatePath, {
        candidate_first_name: candidateFirstName,
        state_name: rule.stateName,
        notice_name: rule.noticeName,
      });

  const text = rule.requiresSurvey
    ? [
        `Hello ${candidateFirstName},`,
        "",
        `Congratulations on starting your new role with ${clientCompanyName}!`,
        "",
        SURVEY_QUESTION_TEXT,
        "Yes / No",
        "",
        "Thanks for choosing to work with Spencer Ogden.",
        "",
        `Regards,`,
        buildFullName(getCandidateOwner(placement)),
      ].join("\n")
    : rule.key === "new-york-city-commuter"
      ? [
          "Notice: Please evaluate this placement for the New York City Commuter benefit",
          "",
          "Hello,",
          "",
          "You recently submitted a placement located in New York for:",
          "",
          `Name: ${candidateFirstName}`,
          normalizeString(placement?.candidate?.lastName),
          `Placement ID: ${normalizeString(placement?.id)}`,
          "",
          "If this person is in New York City please notify usapayrollqueries@spencer-ogden.com to add the NYC based contractor to the commuter benefit system.",
          "",
          "Please provide the following information to your candidate as well:",
          "",
          "Start at www.wageworks.com",
          "- Click on log in/register",
          "- Enter the info to ID yourself (please note the zip code you use is the one listed for you in ADP. If ADP is your old address, you need to use your old zip code)",
          "- your ID code is your social security number",
          "",
          "An overview of the program is located here:",
          "https://www.wageworks.com/employees/commuter-benefit-accounts/commuter-transit-account/",
        ].join("\n")
    : htmlToText(html);

  const recipients = [
    {
      address: {
        email: toEmail,
      },
    },
    ...ccEmails.map((email) => ({
      address: {
        email,
        header_to: toEmail,
      },
    })),
  ].filter((recipient) => normalizeString(recipient?.address?.email));

  return {
    content: {
      from,
      subject: rule.subject,
      text,
      html,
      ...(ccEmails.length > 0 ? { headers: { CC: ccEmails.join(", ") } } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    recipients,
    recipientEnvelope: {
      toEmail,
      ccEmails,
      missingToEmail: !toEmail,
    },
  };
}

function buildPlacementReportRecord({
  placement,
  rule,
  businessDateKey,
  queryDateBegin,
  change,
  transactionId,
  recipientEnvelope,
  sparkPostPayload,
  attachmentPaths,
  sendLock,
}) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDateBegin,
    source: rule.source,
    ruleKey: rule.key,
    transactionId: transactionId || null,
    change: change
      ? {
          oldValue: change.oldValue ?? null,
          newValue: change.newValue ?? null,
        }
      : null,
    surveyRequired: rule.requiresSurvey,
    sendLock,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      dateBegin: placement?.dateBegin || null,
      workState: getPlacementWorkState(placement) || null,
      country: getPlacementCountry(placement) || null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
    recipient: {
      toEmail: recipientEnvelope.toEmail || null,
      ccEmails: recipientEnvelope.ccEmails,
      missingToEmail: recipientEnvelope.missingToEmail,
    },
    attachmentPaths,
    sparkPostPayload,
  };
}

function buildSkippedPlacementPreview({ placement, rule, queryDateBegin, reason, matchDetails = null, change = null, transactionId = null }) {
  return {
    placementId: placement?.id ?? null,
    queryDateBegin,
    source: rule.source,
    ruleKey: rule.key,
    transactionId,
    reason,
    change: change
      ? {
          oldValue: change.oldValue ?? null,
          newValue: change.newValue ?? null,
        }
      : null,
    matchDetails,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      dateBegin: placement?.dateBegin ?? null,
      workState: getPlacementWorkState(placement) || null,
      country: getPlacementCountry(placement) || null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
  };
}

module.exports = {
  AMERICAS_ONBOARDING_TIME_ZONE,
  QUERY_COUNT_DEFAULT,
  RULES,
  SKIPPED_PREVIEW_LIMIT,
  SURVEY_QUESTION_ID,
  SURVEY_QUESTION_TEXT,
  WORKFLOW_NAME,
  buildDateBeginQueryDates,
  buildDelayedStatusChangeDateKeys,
  buildRuleExecutionPlan,
  buildPlacementReportRecord,
  buildSkippedPlacementPreview,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
};
