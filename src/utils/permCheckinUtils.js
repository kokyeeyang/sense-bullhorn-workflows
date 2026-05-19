const {
  buildTrackingPartitionKey,
  buildTrackingRowKey,
} = require("../stores/workflowSurveyTrackingStore");
const { getPlacementCountry } = require("./harassmentTrainingUtils");
const { buildFullName, normalizeString } = require("./placementStartReminderUtils");
const { buildSurveyGeoFields } = require("./surveyGeoUtils");
const { buildWorkflowSurveyToken, normalizeLower } = require("./workflowSurveyUtils");

const WORKFLOW_NAME = "perm-checkin-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const SKIPPED_PREVIEW_LIMIT = 25;
const SURVEY_QUESTION_ID = "perm-first-day-checkin";
const CLIENT_QUESTION_TEXT = "Please confirm that they started work with you today as planned:";
const CANDIDATE_QUESTION_TEXT = "Please can you confirm that you have started as expected?";

const APAC_CLIENT_DEPARTMENTS = [
  "hon - construction and property",
  "hon - contract o&g",
  "hon - perm et",
  "hon - perm finance",
  "malaysia",
  "per - contract engineering",
  "per - contract power & nuclear",
  "per - contract renewables",
  "per - finance",
  "per - perm o&g",
  "sin - contract engineering",
  "sin - contract p&n",
  "sin - et",
  "sin - field services",
  "sin - renewables",
  "sin - property and construction",
  "sin - perm p&n",
  "sin - production and chemicals",
];

const APAC_CANDIDATE_DEPARTMENTS = [
  "malaysia",
  "per - contract engineering",
  "per - contract renewables",
  "per - perm o&g",
  "sin - field services",
  "per - contract power & nuclear",
  "sin - contract engineering",
  "sin - et",
  "sin - renewables",
  "sin - property and construction",
  "sin - perm p&n",
  "per - finance",
  "sin - contract p&n",
  "sin - production and chemicals",
];

const AMERICAS_DEPARTMENTS = [
  "den - contract o&g",
  "den - perm o&g",
  "hou - contract o&g",
  "den - sos",
  "hou - contract craft",
  "hou - contract p&n",
  "hou - dc",
  "hou - contract dc",
  "hou - perm o&g",
  "hou - perm",
  "orl",
  "orl - contract renewables",
  "orl - perm built",
  "orl - contract p&n",
  "new york city",
  "orlando",
  "hou - contract",
  "nyc - perm finance & trading",
  "den - perm - renewables",
  "den - perm - p&u",
  "den - perm built",
  "nyc - perm renewables",
  "nyc - perm built",
  "nyc - perm power",
  "den-perm power",
  "den-power and nuclear",
  "orl- perm renewables",
];

const EMEA_DEPARTMENTS = [
  "lon - contract automation",
  "lon - contract chemicals",
  "lon - contract et",
  "lon - contract o&g",
  "lon - contract o&g drilling",
  "lon - contract p&n",
  "lon - contract renewables",
  "lon - marine",
  "lon - perm engineering",
  "lon - perm et",
  "lon - perm o&g",
  "lon - perm p&n",
  "lon - perm renewables",
  "lon - rail",
  "man - built environment",
  "man - utilities",
  "gla - contract o&g",
  "gla - contract renewables",
  "gla - marine",
  "gla - perm f&t",
  "gla - perm o&g",
  "gla - perm renewables",
];

const RULES = [
  {
    key: "apac-client",
    region: "APAC",
    recipientType: "client",
    sendAtPacificHour: 0,
    departmentContains: APAC_CLIENT_DEPARTMENTS,
    from: "owner",
    to: "clientContact.email",
    subject: "Thank you for working with Spencer Ogden",
  },
  {
    key: "apac-candidate",
    region: "APAC",
    recipientType: "candidate",
    sendAtPacificHour: 0,
    departmentContains: APAC_CANDIDATE_DEPARTMENTS,
    from: "owner",
    to: "candidate.email",
    subject: "Congratulations!",
  },
  {
    key: "americas-client",
    region: "Americas",
    recipientType: "client",
    sendAtPacificHour: 11,
    departmentContains: AMERICAS_DEPARTMENTS,
    excludedCandidateFirstNamePrefixes: ["retain"],
    from: "owner",
    to: "clientContact.email",
    subject: "Thank you for working with Spencer Ogden",
  },
  {
    key: "americas-candidate",
    region: "Americas",
    recipientType: "candidate",
    sendAtPacificHour: 9,
    departmentContains: AMERICAS_DEPARTMENTS,
    excludedCandidateFirstNamePrefixes: ["retain"],
    from: "candidateOwner",
    to: "candidate.email",
    subject: "Congratulations!",
  },
  {
    key: "emea-client",
    region: "EMEA",
    recipientType: "client",
    sendAtPacificHour: 2,
    departmentContains: EMEA_DEPARTMENTS,
    searchType: "contingent",
    excludedPlacementIds: new Set([39409]),
    from: "owner",
    to: "clientContact.email",
    subject: "Thank you for working with Spencer Ogden",
  },
  {
    key: "emea-candidate",
    region: "EMEA",
    recipientType: "candidate",
    sendAtPacificHour: 2,
    departmentContains: EMEA_DEPARTMENTS,
    searchType: "contingent",
    excludedPlacementIds: new Set([39409]),
    from: "owner",
    to: "candidate.email",
    subject: "Congratulations!",
  },
];

function dateKeyToUtcDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(dateKey))) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return {
    startMs,
    endMs: startMs + DAY_MS,
    targetDate: dateKey,
  };
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

function isTimedRuleDue({ rule, businessHour, force = false }) {
  return force || Number(rule.sendAtPacificHour) === Number(businessHour);
}

function buildRuleExecutionPlan({ rule, businessDateKey, businessHour, force = false }) {
  const timedRuleDue = isTimedRuleDue({ rule, businessHour, force });
  return {
    ruleKey: rule.key,
    region: rule.region,
    recipientType: rule.recipientType,
    timedRuleDue,
    expectedPacificHour: Number(rule.sendAtPacificHour),
    businessHour: Number(businessHour),
    queryDateBeginDates: timedRuleDue ? [businessDateKey] : [],
    skippedReason: timedRuleDue ? null : "outside-send-hour",
  };
}

function getOwner(placement) {
  return placement?.owner || placement?.jobOrder?.owner || placement?.candidate?.owner || {};
}

function getCandidateOwner(placement) {
  return placement?.candidate?.owner || getOwner(placement);
}

function getOwnerForFrom(placement, fromConfig) {
  return fromConfig === "candidateOwner" ? getCandidateOwner(placement) : getOwner(placement);
}

function getEmploymentType(placement) {
  return normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
}

function getSearchType(placement) {
  return normalizeLower(placement?.searchType || placement?.jobOrder?.searchType);
}

function getOwnerDepartment(placement) {
  return normalizeLower(getOwner(placement)?.primaryDepartment?.name);
}

function statusContainsAllowedStatus(placement) {
  const status = normalizeLower(placement?.status);
  return ["qc approved", "submitted"].some((allowed) => status.includes(allowed));
}

function departmentMatches(department, departmentContains) {
  return departmentContains.some((needle) => department.includes(normalizeLower(needle)));
}

function candidateFirstNameAllowed(placement, rule) {
  const firstName = normalizeLower(placement?.candidate?.firstName);
  return !(rule.excludedCandidateFirstNamePrefixes || []).some((prefix) =>
    firstName.startsWith(normalizeLower(prefix)),
  );
}

function getMatchDetails(placement, rule) {
  const department = getOwnerDepartment(placement);
  const checks = {
    statusMatches: statusContainsAllowedStatus(placement),
    employmentTypeMatches: getEmploymentType(placement) === "perm",
    ownerDepartmentMatches: departmentMatches(department, rule.departmentContains),
    searchTypeMatches: !rule.searchType || getSearchType(placement) === rule.searchType,
    placementIdAllowed: !(rule.excludedPlacementIds || new Set()).has(Number(placement?.id)),
    candidateFirstNameAllowed: candidateFirstNameAllowed(placement, rule),
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
      ownerDepartment: getOwner(placement)?.primaryDepartment?.name || null,
      searchType: placement?.searchType || placement?.jobOrder?.searchType || null,
      country: getPlacementCountry(placement) || null,
      candidateFirstName: placement?.candidate?.firstName || null,
    },
    expected: {
      statusContains: ["qc approved", "submitted"],
      employmentType: "perm",
      ownerDepartmentContains: rule.departmentContains,
      searchType: rule.searchType || null,
      excludedPlacementIds: rule.excludedPlacementIds ? Array.from(rule.excludedPlacementIds) : [],
      excludedCandidateFirstNamePrefixes: rule.excludedCandidateFirstNamePrefixes || [],
    },
  };
}

function resolvePathValue(placement, selector) {
  const owner = getOwner(placement);
  const candidateOwner = getCandidateOwner(placement);
  const clientContact = placement?.clientContact || placement?.billingClientContact || {};
  const values = {
    "owner.email": owner?.email,
    "candidateOwner.email": candidateOwner?.email,
    "candidate.email": placement?.candidate?.email,
    "clientContact.email": clientContact?.email,
  };
  return values[selector];
}

function resolveEmailValue(placement, selector) {
  const value = normalizeString(selector);
  if (value.includes("@")) {
    return normalizeLower(value);
  }
  return normalizeLower(resolvePathValue(placement, value));
}

function resolveFrom(placement, rule) {
  const owner = getOwnerForFrom(placement, rule.from);
  return {
    name: "Spencer Ogden",
    email: normalizeLower(owner?.email),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSurveyButtonHtml(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;margin:0 8px 12px 0;padding:10px 18px;background:#5630d3;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">${escapeHtml(label)}</a>`;
}

function buildSurveyKey({ placement, rule }) {
  return [
    WORKFLOW_NAME,
    placement?.id ?? "unknown",
    rule.key,
    rule.recipientType,
  ].join("|");
}

function buildSurveyUrl({ placement, rule, config, surveyKey, answer, tracking }) {
  const baseUrl = normalizeString(
    config.PERM_CHECKIN_RESPONSE_BASE_URL || config.WORKFLOW_SURVEY_RESPONSE_BASE_URL,
  );
  if (!baseUrl) {
    return "";
  }

  const owner = getOwner(placement);
  const questionText =
    rule.recipientType === "client" ? CLIENT_QUESTION_TEXT : CANDIDATE_QUESTION_TEXT;
  const token = buildWorkflowSurveyToken({
    secret: config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET,
    payload: {
      workflowName: WORKFLOW_NAME,
      placementId: placement?.id ?? null,
      candidateId: placement?.candidate?.id ?? null,
      ownerId: owner?.id ?? null,
      ownerEmail: normalizeLower(owner?.email),
      recipientEmail: resolveEmailValue(placement, rule.to),
      questionId: SURVEY_QUESTION_ID,
      questionText,
      answer,
      issuedAt: tracking.tokenIssuedAt,
      surveyKey,
      trackingPartitionKey: tracking.partitionKey,
      trackingRowKey: tracking.rowKey,
      metadata: {
        ruleKey: rule.key,
        region: rule.region,
        recipientType: rule.recipientType,
        candidateRegion: tracking.candidateRegion,
        candidateCountry: tracking.candidateCountry,
        assignmentRegion: tracking.assignmentRegion,
        assignmentCountry: tracking.assignmentCountry,
      },
    },
  });

  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("answer", answer);
  return url.toString();
}

function buildClientHtml({ placement, surveyUrls }) {
  const candidate = placement?.candidate || {};
  const clientContact = placement?.clientContact || placement?.billingClientContact || {};
  return [
    "<!doctype html>",
    '<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6;">',
    `<p>Hi ${escapeHtml(normalizeString(clientContact.firstName) || "there")},</p>`,
    `<p>Thank you for choosing to work with Spencer Ogden and hiring our candidate ${escapeHtml(buildFullName(candidate))} to work for you.</p>`,
    `<p>${escapeHtml(CLIENT_QUESTION_TEXT)}</p>`,
    `<p>${buildSurveyButtonHtml(surveyUrls.yes, "Yes")}${buildSurveyButtonHtml(surveyUrls.no, "No")}</p>`,
    "<p>I trust everything has gone smoothly so far but please feel free to contact me if you have any issues or questions, or if you have any further recruitment requirements that Spencer Ogden can help you with.</p>",
    `<p>Regards,<br>${escapeHtml(buildFullName(getCandidateOwner(placement)))}</p>`,
    "</body></html>",
  ].join("");
}

function buildCandidateHtml({ placement, surveyUrls }) {
  const candidate = placement?.candidate || {};
  return [
    "<!doctype html>",
    '<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6;">',
    `<p>Hi ${escapeHtml(normalizeString(candidate.firstName) || "there")},</p>`,
    `<p>Congratulations on starting your new role with ${escapeHtml(normalizeString(placement?.clientCorporation?.name))}!</p>`,
    `<p>${escapeHtml(CANDIDATE_QUESTION_TEXT)}</p>`,
    `<p>${buildSurveyButtonHtml(surveyUrls.yes, "Yes")}${buildSurveyButtonHtml(surveyUrls.no, "No")}</p>`,
    "<p>I hope everything has gone smoothly so far and you've not had any problems. Please feel free to contact me if you have any issues or questions.</p>",
    "<p>Thanks for choosing to work with Spencer Ogden and I hope we can continue to support you throughout your career.</p>",
    `<p>Regards,<br>${escapeHtml(buildFullName(getCandidateOwner(placement)))}</p>`,
    "</body></html>",
  ].join("");
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

function buildTrackingRecord({ placement, rule, businessDateKey, surveyKey, tokenIssuedAt }) {
  const recipientEmail = resolveEmailValue(placement, rule.to);
  const clientContact = placement?.clientContact || placement?.billingClientContact || {};
  const candidateName = buildFullName(placement?.candidate || {});
  const clientContactName = buildFullName(clientContact);
  const geo = buildSurveyGeoFields(placement, { assignmentRegion: rule.region });
  const partitionKey = buildTrackingPartitionKey({
    workflowName: WORKFLOW_NAME,
    reminderDueDate: businessDateKey,
  });
  const rowKey = buildTrackingRowKey({
    reminderDueDate: businessDateKey,
    surveyKey,
  });

  return {
    partitionKey,
    rowKey,
    workflowName: WORKFLOW_NAME,
    surveyKey,
    ruleKey: rule.key,
    sendType: "initial",
    recipientType: rule.recipientType,
    recipientEmail,
    recipientFirstName:
      rule.recipientType === "client"
        ? normalizeString(clientContact.firstName)
        : normalizeString(placement?.candidate?.firstName),
    candidateId: placement?.candidate?.id ?? null,
    candidateName,
    clientContactId: clientContact?.id ?? null,
    clientContactName,
    placementId: placement?.id ?? null,
    clientCorporationId: placement?.clientCorporation?.id ?? null,
    clientCorporationName: normalizeString(placement?.clientCorporation?.name),
    employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || "",
    currentPlacementStatus: placement?.status || "",
    candidateRegion: geo.candidateRegion,
    candidateCountry: geo.candidateCountry,
    assignmentRegion: geo.assignmentRegion,
    assignmentCountry: geo.assignmentCountry,
    businessDate: businessDateKey,
    initialSentAt: new Date().toISOString(),
    initialSentDate: businessDateKey,
    reminderDueDate: "",
    reminderSentAt: "",
    respondedAt: "",
    responseAnswer: "",
    trackingStatus: "pending",
    tokenIssuedAt,
    context: {
      dateBegin: placement?.dateBegin ?? null,
      candidateRegion: geo.candidateRegion,
      candidateCountry: geo.candidateCountry,
      assignmentRegion: geo.assignmentRegion,
      assignmentCountry: geo.assignmentCountry,
      country: getPlacementCountry(placement) || null,
      searchType: placement?.searchType || placement?.jobOrder?.searchType || null,
      ownerDepartment: getOwner(placement)?.primaryDepartment?.name || null,
    },
    metadata: {
      region: rule.region,
      recipientType: rule.recipientType,
      candidateRegion: geo.candidateRegion,
      candidateCountry: geo.candidateCountry,
      assignmentRegion: geo.assignmentRegion,
      assignmentCountry: geo.assignmentCountry,
    },
    runDate: businessDateKey,
  };
}

function buildTransmission({ placement, rule, config, businessDateKey }) {
  const surveyKey = buildSurveyKey({ placement, rule });
  const tokenIssuedAt = new Date().toISOString();
  const tracking = buildTrackingRecord({
    placement,
    rule,
    businessDateKey,
    surveyKey,
    tokenIssuedAt,
  });
  const surveyUrls = {
    yes: buildSurveyUrl({ placement, rule, config, surveyKey, answer: "yes", tracking }),
    no: buildSurveyUrl({ placement, rule, config, surveyKey, answer: "no", tracking }),
  };
  const html =
    rule.recipientType === "client"
      ? buildClientHtml({ placement, surveyUrls })
      : buildCandidateHtml({ placement, surveyUrls });
  const toEmail = tracking.recipientEmail;
  const owner = getOwner(placement);

  return {
    content: {
      from: resolveFrom(placement, rule),
      subject: rule.subject,
      text: htmlToText(html),
      html,
    },
    recipients: toEmail ? [{ address: { email: toEmail } }] : [],
    tracking,
    audit: {
      workflowName: WORKFLOW_NAME,
      sendType: "initial",
      ruleKey: rule.key,
      recipientType: rule.recipientType,
      recipientEmail: toEmail,
      recipientFirstName: tracking.recipientFirstName,
      placementId: placement?.id ?? null,
      candidateId: placement?.candidate?.id ?? null,
      clientContactId: tracking.clientContactId ?? null,
      clientCorporationId: placement?.clientCorporation?.id ?? null,
      ownerId: owner?.id ?? null,
      ownerEmail: normalizeLower(owner?.email),
      surveyKey,
      businessDate: businessDateKey,
      runDate: businessDateKey,
      context: tracking.context,
      metadata: tracking.metadata,
    },
    recipientEnvelope: {
      toEmail,
      missingToEmail: !toEmail,
    },
  };
}

function buildReportItem({
  placement,
  rule,
  businessDateKey,
  queryDateBegin,
  reason = null,
  matchDetails = null,
  recipientEnvelope = null,
  sparkPostPayload = null,
  sendLock = null,
}) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDateBegin,
    ruleKey: rule.key,
    region: rule.region,
    recipientType: rule.recipientType,
    reason,
    matchDetails,
    sendLock,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      dateBegin: placement?.dateBegin ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      country: getPlacementCountry(placement) || null,
      searchType: placement?.searchType || placement?.jobOrder?.searchType || null,
      ownerDepartment: getOwner(placement)?.primaryDepartment?.name || null,
      owner: getOwner(placement),
      candidate: placement?.candidate || null,
      clientContact: placement?.clientContact || placement?.billingClientContact || null,
      clientCorporation: placement?.clientCorporation || null,
    },
    recipient: recipientEnvelope,
    sparkPostPayload,
  };
}

module.exports = {
  CANDIDATE_QUESTION_TEXT,
  CLIENT_QUESTION_TEXT,
  QUERY_COUNT_DEFAULT,
  RULES,
  SKIPPED_PREVIEW_LIMIT,
  SURVEY_QUESTION_ID,
  TIME_ZONE,
  WORKFLOW_NAME,
  buildReportItem,
  buildRuleExecutionPlan,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  formatDateKey,
  getBusinessDateParts,
  getMatchDetails,
};
