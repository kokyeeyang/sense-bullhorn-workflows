const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, normalizeString } = require("./placementStartReminderUtils");
const { buildWorkflowSurveyToken, normalizeLower } = require("./workflowSurveyUtils");
const {
  buildTrackingPartitionKey,
  buildTrackingRowKey,
} = require("../stores/workflowSurveyTrackingStore");

const WORKFLOW_NAME = "so-how-did-we-do-feedback-sync";
const SO_HOW_DID_WE_DO_TIME_ZONE = "America/Los_Angeles";
const SEND_HOUR = 11;
const DAY_MS = 24 * 60 * 60 * 1000;
const SURVEY_QUESTION_ID = "so-how-did-we-do-nps";
const SURVEY_QUESTION_TEXT =
  "How likely are you to recommend Spencer Ogden to a friend or colleague?";
const SCORE_OPTIONS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const SCORE_LEFT_LABEL = "Not likely at all";
const SCORE_RIGHT_LABEL = "Extremely likely";
const SKIPPED_PREVIEW_LIMIT = 25;
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "so-how-did-we-do-feedback.html");
const REMINDER_TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "so-how-did-we-do-reminder.html");

const EXCLUDED_CLIENT_CORPORATION_IDS = new Set(["10397", "32", "56847", "1121479", "13990"]);
const EXCLUDED_BILLING_CLIENT_CONTACT_IDS = new Set(["13990", "333592", "1121479", "429359"]);
const EXCLUDED_CLIENT_CONTACT_IDS = new Set([
  "1121479",
  "2053337",
  "1713763",
  "1871677",
  "1981645",
  "1006099",
  "1482211",
  "1645934",
  "1933339",
  "919422",
  "115158",
  "2167916",
  "1089247",
  "757412",
  "1932609",
  "2068360",
  "1214990",
  "2410059",
  "112724",
  "429359",
  "547589",
  "112896",
  "104858",
  "105723",
]);
const EXCLUDED_OWNER_PAGERS = new Set(["1", "125"]);
const EXCLUDED_CLIENT_OWNER_IDS = new Set([
  "3174438","3146242","3146243","2039243","1941845","2866577","2325589","3074247",
  "3173626","3121602","3110477","3091907","3188614","2538392","3066526","2947625",
  "3157200","2538393","2812257","2929511","2733084","3038120","2914933","3168429","3112770",
]);
const EXCLUDED_CANDIDATE_OWNER_IDS = new Set([
  "1941845","2866577","2325589","3110477","3091907","2538392","2947625","2538393",
  "2812257","2929511","2733084","3038120","2914933","3348141","3336379","3327559",
  "3275834","3264225","3326411","3234680","2855669","3348442","3316242","3235902",
  "3225890","3316210",
]);
const EXCLUDED_CANDIDATE_IDS = new Set(["1996783", "2349818", "2438126"]);
const EXCLUDED_PLACEMENT_IDS = new Set(["29049"]);
const EXCLUDED_CANDIDATE_OWNER_DEPARTMENTS = new Set(["lon - contract o&g"]);

const RULES = [
  {
    key: "client-exit-contract",
    source: "dateEnd",
    delayDays: 2,
    sendAtPacificHour: SEND_HOUR,
    weekendPolicy: "send-anyway",
    recipientType: "client-contact",
    to: "clientContact.email",
    subject: "SO.... How did we do?",
    senderName: "Spencer Ogden",
    senderEmail: "sohowdidwedo@spencer-ogden.com",
    allowedStatuses: new Set(["completed", "terminated"]),
    allowedEmploymentTypes: new Set(["contract", "margin only", "marginonly"]),
    excludeClientCorporationIds: EXCLUDED_CLIENT_CORPORATION_IDS,
    excludeBillingClientContactIds: new Set(["13990", "333592", "1121479"]),
    excludeClientContactIds: new Set([
      "1121479","2053337","1713763","1871677","1981645","1006099","1482211","1645934",
      "1933339","919422","115158","2167916","1089247","757412","1932609","2068360","1214990","2410059","112724",
    ]),
    excludeOwnerPagers: EXCLUDED_OWNER_PAGERS,
    excludeOwnerIds: EXCLUDED_CLIENT_OWNER_IDS,
    introParagraphs: [
      "Thank you for choosing to work with Spencer Ogden. We would appreciate feedback on your experience with us. The below link will take you to one simple question where you can share how we performed on a scale 1-10.",
    ],
  },
  {
    key: "candidate-exit-contract",
    source: "dateEnd",
    delayDays: 2,
    sendAtPacificHour: SEND_HOUR,
    weekendPolicy: "send-anyway",
    recipientType: "candidate",
    to: "candidate.email",
    subject: "SO.... How did we do?",
    senderName: "Spencer Ogden",
    senderEmail: "sohowdidwedo@spencer-ogden.com",
    allowedStatuses: new Set(["completed", "terminated"]),
    allowedEmploymentTypes: new Set(["contract", "margin only", "marginonly"]),
    excludeClientCorporationIds: EXCLUDED_CLIENT_CORPORATION_IDS,
    excludeBillingClientContactIds: new Set(["13990", "333592", "1121479"]),
    excludeCandidateOwnerDepartments: EXCLUDED_CANDIDATE_OWNER_DEPARTMENTS,
    excludeCandidateIds: new Set(["1996783"]),
    excludePlacementIds: EXCLUDED_PLACEMENT_IDS,
    excludeOwnerPagers: EXCLUDED_OWNER_PAGERS,
    excludeOwnerIds: EXCLUDED_CANDIDATE_OWNER_IDS,
    introParagraphs: [
      "Thank you for choosing to carry out your assignment with Spencer Ogden. Now you have completed your placement with us, we would appreciate feedback on your experience with us during your assignment by answering the question below.",
    ],
  },
  {
    key: "candidate-start-contract",
    source: "dateBegin",
    delayDays: 0,
    sendAtPacificHour: SEND_HOUR,
    weekendPolicy: "send-anyway",
    recipientType: "candidate",
    to: "candidate.email",
    subject: "SO.... How did we do?",
    senderName: "Spencer Ogden",
    senderEmail: "sohowdidwedo@spencer-ogden.com",
    allowedStatuses: new Set(["qc approved", "approved"]),
    allowedEmploymentTypes: new Set(["contract", "margin only", "marginonly"]),
    excludeCandidateOwnerDepartments: EXCLUDED_CANDIDATE_OWNER_DEPARTMENTS,
    excludeCandidateIds: new Set(["1996783"]),
    excludeOwnerPagers: EXCLUDED_OWNER_PAGERS,
    excludeOwnerIds: EXCLUDED_CANDIDATE_OWNER_IDS,
    introParagraphs: [
      "Thank you for choosing Spencer Ogden as your recruitment partner.",
      "Every time we place a candidate into a role we make a donation to Seven Clean Seas to remove 1kg plastic from the world's oceans. To date, through our partnership with Seven Clean Seas we have removed thousands of kgs. of plastic from the ocean. Together we are: \"creating careers to power a sustainable future\".",
      "Thank you for choosing to work with Spencer Ogden, we are constantly striving to develop and improve our service. We would appreciate feedback on your recent experience by answering the question below.",
    ],
  },
  {
    key: "candidate-start-perm",
    source: "dateBegin",
    delayDays: 1,
    sendAtPacificHour: SEND_HOUR,
    weekendPolicy: "send-anyway",
    recipientType: "candidate",
    to: "candidate.email",
    subject: "SO.... How did we do?",
    senderName: "Spencer Ogden",
    senderEmail: "sohowdidwedo@spencer-ogden.com",
    allowedStatuses: new Set(["approved"]),
    allowedEmploymentTypes: new Set(["perm"]),
    excludeCandidateFirstNameContains: new Set(["retain"]),
    excludeCandidateIds: new Set(["2349818", "2438126"]),
    excludeOwnerPagers: EXCLUDED_OWNER_PAGERS,
    introParagraphs: [
      "Thank you for choosing Spencer Ogden as your recruitment partner.",
      "Every time we place a candidate into a role we make a donation to Seven Clean Seas to remove 1kg plastic from the world's oceans. To date, through our partnership with Seven Clean Seas we have removed thousands of kgs. of plastic from the ocean. Together we are: \"creating careers to power a sustainable future\".",
      "Thank you for choosing to work with Spencer Ogden, we are constantly striving to develop and improve our service. We would appreciate feedback on your recent experience by answering the question below.",
    ],
  },
  {
    key: "client-start-contract",
    source: "dateBegin",
    delayDays: 1,
    sendAtPacificHour: SEND_HOUR,
    weekendPolicy: "send-anyway",
    recipientType: "client-contact",
    to: "clientContact.email",
    subject: "SO.... How did we do?",
    senderName: "Spencer Ogden",
    senderEmail: "sohowdidwedo@spencer-ogden.com",
    allowedStatuses: new Set(["qc approved", "approved"]),
    allowedEmploymentTypes: new Set(["contract", "margin only", "marginonly"]),
    excludeClientCorporationIds: EXCLUDED_CLIENT_CORPORATION_IDS,
    excludeBillingClientContactIds: EXCLUDED_BILLING_CLIENT_CONTACT_IDS,
    excludeClientContactIds: EXCLUDED_CLIENT_CONTACT_IDS,
    excludeOwnerPagers: EXCLUDED_OWNER_PAGERS,
    excludeOwnerIds: EXCLUDED_CLIENT_OWNER_IDS,
    introParagraphs: [
      "Thank you for choosing Spencer Ogden as your recruitment partner.",
      "Every time we place a candidate into a role we make a donation to Seven Clean Seas to remove 1kg plastic from the world's oceans. To date, through our partnership with Seven Clean Seas we have removed thousands of kgs. of plastic from the ocean. Together we are: \"creating careers to power a sustainable future\".",
      "Thank you for choosing to work with Spencer Ogden, we are constantly striving to develop and improve our service. We would appreciate feedback on your recent experience by answering the question below.",
    ],
  },
];

let cachedTemplate = null;
let cachedReminderTemplate = null;

function loadTemplate() {
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(TEMPLATE_PATH, "utf8");
  }

  return cachedTemplate;
}

function loadReminderTemplate() {
  if (!cachedReminderTemplate) {
    cachedReminderTemplate = fs.readFileSync(REMINDER_TEMPLATE_PATH, "utf8");
  }

  return cachedReminderTemplate;
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
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

function getBusinessDateParts({ baseDate = new Date(), timeZone = SO_HOW_DID_WE_DO_TIME_ZONE } = {}) {
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

function buildReminderDueDates({ businessDateKey }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [];
  }

  if (dayOfWeek === 1) {
    return [addDays(businessDateKey, -2), addDays(businessDateKey, -1), businessDateKey];
  }

  return [businessDateKey];
}

function isTimedRuleDue({ businessHour, force = false }) {
  return force || Number(businessHour) === SEND_HOUR;
}

function normalizeEmploymentType(value) {
  return normalizeLower(value).replace(/\s+/g, "");
}

function normalizeSet(values = []) {
  return new Set(Array.from(values).map((value) => normalizeLower(value)));
}

function getOwner(placement) {
  return placement?.owner || {};
}

function getCandidateOwner(placement) {
  return placement?.candidate?.owner || {};
}

function getClientContact(placement) {
  return placement?.clientContact || {};
}

function getBillingClientContact(placement) {
  return placement?.billingClientContact || {};
}

function resolveRecipientEmail(placement, rule) {
  if (rule.to === "candidate.email") {
    return normalizeLower(placement?.candidate?.email);
  }

  if (rule.to === "clientContact.email") {
    return normalizeLower(getClientContact(placement)?.email);
  }

  return "";
}

function resolveRecipientFirstName(placement, rule) {
  if (rule.recipientType === "candidate") {
    return normalizeString(placement?.candidate?.firstName) || "there";
  }

  return normalizeString(getClientContact(placement)?.firstName) || "there";
}

function buildSurveyKey({ ruleKey, placementId, recipientType, recipientEmail }) {
  const fingerprint = [
    WORKFLOW_NAME,
    normalizeString(ruleKey),
    placementId ?? "",
    normalizeString(recipientType),
    normalizeLower(recipientEmail),
  ].join("|");

  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

function buildSurveyLinks({ surveyKey, ruleKey, placement, recipientEmail, config, reminderDueDate }) {
  const baseUrl = normalizeString(config.WORKFLOW_SURVEY_RESPONSE_BASE_URL);
  if (!baseUrl) {
    return {};
  }

  const partitionKey = buildTrackingPartitionKey({
    workflowName: WORKFLOW_NAME,
    reminderDueDate,
  });
  const rowKey = buildTrackingRowKey({
    reminderDueDate,
    surveyKey,
  });

  return Object.fromEntries(
    SCORE_OPTIONS.map((answer) => {
      const token = buildWorkflowSurveyToken({
        secret: config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET,
        payload: {
          workflowName: WORKFLOW_NAME,
          placementId: placement?.id ?? null,
          candidateId: placement?.candidate?.id ?? null,
          ownerId: getOwner(placement)?.id ?? null,
          ownerEmail: normalizeLower(getOwner(placement)?.email) || null,
          recipientEmail,
          questionId: SURVEY_QUESTION_ID,
          questionText: SURVEY_QUESTION_TEXT,
          answer,
          issuedAt: new Date().toISOString(),
          surveyKey,
          trackingPartitionKey: partitionKey,
          trackingRowKey: rowKey,
          metadata: {
            ruleKey,
            recipientType: placement?.candidate?.email && normalizeLower(placement.candidate.email) === recipientEmail
              ? "candidate"
              : "client-contact",
          },
        },
      });
      const url = new URL(baseUrl);
      url.searchParams.set("token", token);
      url.searchParams.set("answer", answer);
      return [answer, url.toString()];
    }),
  );
}

function buildScoreScaleHtml(linksByAnswer) {
  const cells = SCORE_OPTIONS.map((answer) => `
    <td style="padding:4px;">
      <a href="${escapeHtml(linksByAnswer[answer] || "#")}" style="display:inline-block;min-width:34px;padding:10px 8px;border:1px solid #c7ced8;border-radius:6px;text-align:center;text-decoration:none;color:#202124;font-weight:700;background:#ffffff;">${answer}</a>
    </td>
  `).join("");

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 8px;">
      <tr>${cells}</tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td style="font-size:12px;line-height:18px;color:#667085;text-align:left;">${escapeHtml(SCORE_LEFT_LABEL)}</td>
        <td style="font-size:12px;line-height:18px;color:#667085;text-align:right;">${escapeHtml(SCORE_RIGHT_LABEL)}</td>
      </tr>
    </table>
  `;
}

function getInitialQueryDate({ businessDateKey, rule }) {
  return addDays(businessDateKey, -Number(rule.delayDays || 0));
}

function buildRuleExecutionPlan({ rule, businessDateKey, businessHour, force = false }) {
  const timedRuleDue = isTimedRuleDue({ businessHour, force });
  return {
    ruleKey: rule.key,
    source: rule.source,
    timedRuleDue,
    expectedPacificHour: SEND_HOUR,
    businessHour: Number(businessHour),
    queryDate: timedRuleDue ? getInitialQueryDate({ businessDateKey, rule }) : null,
    skippedReason: timedRuleDue ? null : "outside-send-hour",
  };
}

function matchSet(set, value, normalizer = normalizeLower) {
  if (!set || set.size === 0) {
    return true;
  }
  return set.has(normalizer(value));
}

function getMatchDetails(placement, rule) {
  const status = normalizeLower(placement?.status);
  const employmentType = normalizeEmploymentType(placement?.employmentType || placement?.jobOrder?.employmentType);
  const clientCorporationId = normalizeString(placement?.clientCorporation?.id);
  const billingClientContactId = normalizeString(getBillingClientContact(placement)?.id);
  const clientContactId = normalizeString(getClientContact(placement)?.id);
  const ownerId = normalizeString(getOwner(placement)?.id);
  const ownerPager = normalizeString(getOwner(placement)?.pager);
  const candidateOwnerDepartment = normalizeLower(getCandidateOwner(placement)?.primaryDepartment?.name);
  const candidateId = normalizeString(placement?.candidate?.id);
  const placementId = normalizeString(placement?.id);
  const candidateFirstName = normalizeLower(placement?.candidate?.firstName);

  const checks = {
    statusMatches: matchSet(rule.allowedStatuses, status),
    employmentTypeMatches: matchSet(rule.allowedEmploymentTypes, employmentType, normalizeEmploymentType),
    clientCorporationAllowed: !(rule.excludeClientCorporationIds || new Set()).has(clientCorporationId),
    billingClientContactAllowed: !(rule.excludeBillingClientContactIds || new Set()).has(billingClientContactId),
    clientContactAllowed: !(rule.excludeClientContactIds || new Set()).has(clientContactId),
    ownerPagerAllowed: !(rule.excludeOwnerPagers || new Set()).has(ownerPager),
    ownerAllowed: !(rule.excludeOwnerIds || new Set()).has(ownerId),
    candidateOwnerDepartmentAllowed: !(rule.excludeCandidateOwnerDepartments || new Set()).has(candidateOwnerDepartment),
    candidateAllowed: !(rule.excludeCandidateIds || new Set()).has(candidateId),
    placementAllowed: !(rule.excludePlacementIds || new Set()).has(placementId),
    candidateFirstNameAllowed: !Array.from(rule.excludeCandidateFirstNameContains || []).some((fragment) =>
      candidateFirstName.includes(normalizeLower(fragment)),
    ),
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
      clientCorporationId: placement?.clientCorporation?.id ?? null,
      billingClientContactId: getBillingClientContact(placement)?.id ?? null,
      clientContactId: getClientContact(placement)?.id ?? null,
      ownerPager: getOwner(placement)?.pager ?? null,
      ownerId: getOwner(placement)?.id ?? null,
      candidateOwnerDepartment: getCandidateOwner(placement)?.primaryDepartment?.name ?? null,
      candidateId: placement?.candidate?.id ?? null,
      placementId: placement?.id ?? null,
      candidateFirstName: placement?.candidate?.firstName ?? null,
    },
    expected: {
      statuses: Array.from(rule.allowedStatuses || []),
      employmentTypes: Array.from(rule.allowedEmploymentTypes || []),
    },
  };
}

function buildIntroHtml(paragraphs) {
  return paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapeHtml(paragraph)}</p>`)
    .join("");
}

function buildInitialHtml({ rule, placement, linksByAnswer }) {
  const introHtml = buildIntroHtml(rule.introParagraphs || []);
  const scaleHtml = buildScoreScaleHtml(linksByAnswer);
  const callToAction = rule.recipientType === "candidate"
    ? "Please click the link below to share your experience."
    : "Please click on the below link to share your experience.";

  return renderTemplate(loadTemplate(), {
    greeting_name: escapeHtml(resolveRecipientFirstName(placement, rule)),
    intro_html: introHtml,
    call_to_action: escapeHtml(callToAction),
    question_text: escapeHtml(SURVEY_QUESTION_TEXT),
    scale_html: scaleHtml,
  });
}

function buildReminderHtml({ placement, rule, linksByAnswer }) {
  return renderTemplate(loadReminderTemplate(), {
    greeting_name: escapeHtml(resolveRecipientFirstName(placement, rule)),
    scale_html: buildScoreScaleHtml(linksByAnswer),
    question_text: escapeHtml(SURVEY_QUESTION_TEXT),
  });
}

function buildInitialText({ rule }) {
  return [
    "Thank you for choosing to work with Spencer Ogden.",
    "",
    ...((rule.introParagraphs || []).slice(0, -1)),
    "",
    SURVEY_QUESTION_TEXT,
    SCORE_OPTIONS.join(" "),
    `${SCORE_LEFT_LABEL} ... ${SCORE_RIGHT_LABEL}`,
  ].filter(Boolean).join("\n");
}

function buildReminderText() {
  return [
    "Just a quick reminder to share your feedback on your recent experience with Spencer Ogden.",
    "",
    "We would really appreciate it if you could take a moment to answer one simple question using the links below.",
    "",
    SURVEY_QUESTION_TEXT,
    SCORE_OPTIONS.join(" "),
    `${SCORE_LEFT_LABEL} ... ${SCORE_RIGHT_LABEL}`,
    "",
    "Thank you,",
    "Spencer Ogden",
  ].join("\n");
}

function buildInitialTransmission({ placement, rule, config, businessDateKey }) {
  const toEmail = resolveRecipientEmail(placement, rule);
  const surveyKey = buildSurveyKey({
    ruleKey: rule.key,
    placementId: placement?.id,
    recipientType: rule.recipientType,
    recipientEmail: toEmail,
  });
  const reminderDueDate = addDays(businessDateKey, 3);
  const linksByAnswer = buildSurveyLinks({
    surveyKey,
    ruleKey: rule.key,
    placement,
    recipientEmail: toEmail,
    config,
    reminderDueDate,
  });

  const content = {
    from: {
      name: rule.senderName,
      email: rule.senderEmail,
    },
    subject: rule.subject,
    text: buildInitialText({ rule }),
    html: buildInitialHtml({ rule, placement, linksByAnswer }),
  };

  return {
    content,
    recipients: toEmail ? [{ address: { email: toEmail } }] : [],
    recipientEnvelope: {
      toEmail,
      missingToEmail: !toEmail,
    },
    tracking: {
      surveyKey,
      linksByAnswer,
      reminderDueDate,
      recipientEmail: toEmail,
      recipientFirstName: resolveRecipientFirstName(placement, rule),
    },
  };
}

function buildReminderTransmission({ entity }) {
  const context = JSON.parse(entity.contextJson || "{}");
  const linksByAnswer = context.linksByAnswer || {};
  const rule = RULES.find((item) => item.key === entity.ruleKey);

  return {
    content: {
      from: {
        name: "Spencer Ogden",
        email: "sohowdidwedo@spencer-ogden.com",
      },
      subject: "Reminder: SO.... How did we do?",
      text: buildReminderText(),
      html: buildReminderHtml({
        placement: {
          candidate: { firstName: entity.recipientFirstName },
          clientContact: { firstName: entity.recipientFirstName },
        },
        rule,
        linksByAnswer,
      }),
    },
    recipients: [{ address: { email: normalizeLower(entity.recipientEmail) } }],
    recipientEnvelope: {
      toEmail: normalizeLower(entity.recipientEmail),
      missingToEmail: !normalizeLower(entity.recipientEmail),
    },
    tracking: {
      surveyKey: entity.surveyKey,
      linksByAnswer,
      reminderDueDate: entity.reminderDueDate,
      recipientEmail: normalizeLower(entity.recipientEmail),
      recipientFirstName: entity.recipientFirstName || "",
    },
  };
}

function buildTrackingRecord({ placement, rule, businessDateKey, transmissionPayload }) {
  const tracking = transmissionPayload.tracking;
  const candidateName = buildFullName(placement?.candidate);
  const clientContactName = buildFullName(getClientContact(placement));
  const initialSentAt = new Date().toISOString();

  return {
    partitionKey: buildTrackingPartitionKey({
      workflowName: WORKFLOW_NAME,
      reminderDueDate: tracking.reminderDueDate,
    }),
    rowKey: buildTrackingRowKey({
      reminderDueDate: tracking.reminderDueDate,
      surveyKey: tracking.surveyKey,
    }),
    workflowName: WORKFLOW_NAME,
    surveyKey: tracking.surveyKey,
    ruleKey: rule.key,
    recipientType: rule.recipientType,
    recipientEmail: tracking.recipientEmail,
    recipientFirstName: tracking.recipientFirstName,
    candidateId: placement?.candidate?.id ?? null,
    candidateName,
    clientContactId: getClientContact(placement)?.id ?? null,
    clientContactName,
    placementId: placement?.id ?? null,
    clientCorporationId: placement?.clientCorporation?.id ?? null,
    clientCorporationName: placement?.clientCorporation?.name || "",
    employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || "",
    currentPlacementStatus: placement?.status || "",
    businessDate: businessDateKey,
    initialSentAt,
    initialSentDate: businessDateKey,
    reminderDueDate: tracking.reminderDueDate,
    reminderSentAt: "",
    respondedAt: "",
    responseAnswer: "",
    trackingStatus: "pending",
    tokenIssuedAt: initialSentAt,
    context: {
      linksByAnswer: tracking.linksByAnswer,
      ruleKey: rule.key,
      subject: rule.subject,
    },
    metadata: {
      source: rule.source,
      delayDays: rule.delayDays,
      sendType: "initial",
    },
    runDate: businessDateKey,
  };
}

function buildReportItem({ placement, rule, businessDateKey, queryDate, sendType, recipientEnvelope, sparkPostPayload, trackingRecord, reason = null, matchDetails = null }) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDate,
    sendType,
    ruleKey: rule?.key || trackingRecord?.ruleKey || null,
    reason,
    matchDetails,
    tracking: trackingRecord
      ? {
          surveyKey: trackingRecord.surveyKey,
          reminderDueDate: trackingRecord.reminderDueDate,
          reminderSentAt: trackingRecord.reminderSentAt || null,
          respondedAt: trackingRecord.respondedAt || null,
          responseAnswer: trackingRecord.responseAnswer || null,
          trackingStatus: trackingRecord.trackingStatus || null,
        }
      : null,
    placement: placement
      ? {
          id: placement?.id ?? null,
          status: placement?.status || null,
          employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
          dateBegin: placement?.dateBegin ?? null,
          dateEnd: placement?.dateEnd ?? null,
          candidate: placement?.candidate || null,
          clientContact: placement?.clientContact || null,
          billingClientContact: placement?.billingClientContact || null,
          clientCorporation: placement?.clientCorporation || null,
          owner: placement?.owner || null,
        }
      : null,
    recipient: recipientEnvelope
      ? {
          toEmail: recipientEnvelope.toEmail || null,
          missingToEmail: recipientEnvelope.missingToEmail,
        }
      : null,
    sparkPostPayload,
  };
}

module.exports = {
  DAY_MS,
  RULES,
  SCORE_OPTIONS,
  SCORE_LEFT_LABEL,
  SCORE_RIGHT_LABEL,
  SEND_HOUR,
  SKIPPED_PREVIEW_LIMIT,
  SO_HOW_DID_WE_DO_TIME_ZONE,
  SURVEY_QUESTION_ID,
  SURVEY_QUESTION_TEXT,
  WORKFLOW_NAME,
  addDays,
  buildReminderDueDates,
  buildInitialTransmission,
  buildReminderTransmission,
  buildReportItem,
  buildRuleExecutionPlan,
  buildTrackingRecord,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
};
