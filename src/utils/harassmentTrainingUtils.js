const crypto = require("node:crypto");
const path = require("node:path");

const {
  buildFullName,
  normalizeString,
} = require("./placementStartReminderUtils");

const DAY_MS = 24 * 60 * 60 * 1000;
const HARASSMENT_TRAINING_TIME_ZONE = "America/Los_Angeles";
const APPROVED_STATUS_VALUES = new Set(["qc approved", "approved"]);
const ILLINOIS_MAINE_STATUS_VALUES = new Set(["qc approved", "submitted", "approved"]);

const STATE_RULES = {
  illinois: {
    key: "illinois",
    stateLabel: "Illinois",
    templateVariant: "onboarding-confirmation",
    workflowLabel: "Americas Illinois Onboarding - Anti Harassment Training",
    attachmentConfigKey: "HARASSMENT_TRAINING_ILLINOIS_ATTACHMENT_PATH",
    requiresConfirmation: true,
    source: "dateBegin",
  },
  maine: {
    key: "maine",
    stateLabel: "Maine",
    templateVariant: "onboarding-confirmation",
    workflowLabel: "Americas Maine Onboarding - Anti Harassment Training",
    attachmentConfigKey: "HARASSMENT_TRAINING_MAINE_ATTACHMENT_PATH",
    requiresConfirmation: true,
    source: "dateBegin",
  },
  connecticut: {
    key: "connecticut",
    stateLabel: "Connecticut",
    templateVariant: "state-training-notice",
    workflowLabel: "Americas Connecticut Sexual Harassment Training",
    attachmentConfigKey: "HARASSMENT_TRAINING_CONNECTICUT_ATTACHMENT_PATH",
    requiresConfirmation: false,
    source: "statusChange",
    trainingUrl:
      "https://portal.ct.gov/CHRO/Sexual-Harassment-Prevention-Training/Pages/Sexual-Harassment-Prevention-Resources",
  },
  "new york": {
    key: "new-york",
    stateLabel: "New York",
    templateVariant: "state-training-notice",
    workflowLabel: "Americas New York Sexual Harassment Training",
    attachmentConfigKey: "HARASSMENT_TRAINING_NEW_YORK_ATTACHMENT_PATH",
    requiresConfirmation: false,
    source: "statusChange",
    trainingUrl:
      "https://portal.ct.gov/CHRO/Sexual-Harassment-Prevention-Training/Pages/Sexual-Harassment-Prevention-Resources",
  },
  california: {
    key: "california",
    stateLabel: "California",
    templateVariant: "california-training-notice",
    workflowLabel: "Americas California Anti-Harassment Training",
    attachmentConfigKey: "HARASSMENT_TRAINING_CALIFORNIA_ATTACHMENT_PATH",
    requiresConfirmation: false,
    source: "statusChange",
    trainingUrl: "https://www.dfeh.ca.gov/shpt/",
  },
};

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeStatus(value) {
  return normalizeLower(value);
}

function normalizeState(value) {
  return normalizeLower(value);
}

function normalizeCountry(value) {
  const country = normalizeLower(value);
  if (country === "us" || country === "usa" || country === "united states of america") {
    return "united states";
  }
  return country;
}

function getPlacementWorkState(placement) {
  return (
    normalizeString(placement?.workState) ||
    normalizeString(placement?.address?.state) ||
    normalizeString(placement?.jobOrder?.address?.state)
  );
}

function getPlacementCountry(placement) {
  return (
    normalizeString(placement?.country) ||
    normalizeString(placement?.address?.countryName) ||
    normalizeString(placement?.jobOrder?.address?.countryName) ||
    normalizeString(placement?.candidate?.address?.countryName)
  );
}

function getEmploymentType(placement) {
  return normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
}

function isUnitedStatesPlacement(placement) {
  const country = normalizeCountry(getPlacementCountry(placement));
  if (country) {
    return country === "united states";
  }

  return Boolean(normalizeState(getPlacementWorkState(placement)));
}

function parseConfiguredFields(value) {
  return normalizeString(value)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function getNestedValue(source, pathValue) {
  return pathValue.split(".").reduce((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    return current[key];
  }, source);
}

function hasHarassmentTrainingFlag(placement, { flagFields = "" } = {}) {
  const values = [
    placement?.customText1,
    placement?.customText2,
    placement?.customText3,
    placement?.customText4,
    placement?.customText5,
    placement?.customText6,
    placement?.customText7,
    placement?.customText8,
    placement?.customText9,
    placement?.customText10,
    placement?.customText11,
    placement?.customText12,
    placement?.customText13,
    placement?.customText14,
    placement?.customText15,
    placement?.customText16,
    placement?.customText17,
    placement?.customText18,
    placement?.customText19,
    placement?.customText20,
    placement?.customTextBlock1,
    ...parseConfiguredFields(flagFields).map((field) => getNestedValue(placement, field)),
  ];

  return values.some((value) => normalizeLower(value).includes("sexual harassment training"));
}

function isApprovedStatus(value) {
  return APPROVED_STATUS_VALUES.has(normalizeStatus(value));
}

function isSubmittedOrPreHireStatus(value) {
  return ["submitted", "pre-hire"].includes(normalizeStatus(value));
}

function matchesIllinoisMainePlacement(placement, options = {}) {
  const details = getIllinoisMaineMatchDetails(placement, options);
  return details.matches;
}

function getIllinoisMaineMatchDetails(placement, options = {}) {
  const state = normalizeState(getPlacementWorkState(placement));
  const status = normalizeStatus(placement?.status);
  const acceptedStatuses = new Set([
    ...ILLINOIS_MAINE_STATUS_VALUES,
    ...parseConfiguredFields(options.extraStatuses).map((value) => normalizeStatus(value)),
  ]);
  const stateMatches = ["illinois", "maine"].includes(state);
  const statusMatches = acceptedStatuses.has(status);
  const countryMatches = isUnitedStatesPlacement(placement);
  const trainingFlagFound = hasHarassmentTrainingFlag(placement, options);

  return {
    matches: stateMatches && statusMatches && countryMatches,
    stateMatches,
    statusMatches,
    countryMatches,
    trainingFlagMatches: trainingFlagFound,
    trainingFlagRequired: false,
    trainingFlagFound,
    actual: {
      state: getPlacementWorkState(placement) || null,
      country: getPlacementCountry(placement) || null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
    },
    expected: {
      state: "Illinois or Maine",
      country: "United States",
      status: Array.from(acceptedStatuses),
      trainingFlag: "not required",
      configuredTrainingFlagFields: parseConfiguredFields(options.flagFields),
      trainingFlagRequired: false,
    },
  };
}

function matchesConnecticutNewYorkPlacement({ placement, statusChange }) {
  const state = normalizeState(getPlacementWorkState(placement));
  return (
    ["connecticut", "new york"].includes(state) &&
    getEmploymentType(placement) === "contract" &&
    isApprovedStatus(statusChange?.newValue || placement?.status)
  );
}

function matchesCaliforniaPlacement({ placement, statusChange }) {
  const state = normalizeState(getPlacementWorkState(placement));
  return (
    state === "california" &&
    getEmploymentType(placement) === "contract" &&
    isUnitedStatesPlacement(placement) &&
    isSubmittedOrPreHireStatus(statusChange?.oldValue) &&
    isApprovedStatus(statusChange?.newValue || placement?.status)
  );
}

function findRuleForPlacement({ placement, statusChange = null, source, config = {} }) {
  const state = normalizeState(getPlacementWorkState(placement));
  const rule = STATE_RULES[state] || null;
  if (!rule || (source && rule.source !== source)) {
    return null;
  }

  if (rule.source === "dateBegin") {
    return matchesIllinoisMainePlacement(placement, {
      flagFields: config.HARASSMENT_TRAINING_FLAG_FIELDS,
      extraStatuses: config.HARASSMENT_TRAINING_EXTRA_DATE_BEGIN_STATUSES,
    })
      ? rule
      : null;
  }

  if (["connecticut", "new york"].includes(state)) {
    return matchesConnecticutNewYorkPlacement({ placement, statusChange }) ? rule : null;
  }

  if (state === "california") {
    return matchesCaliforniaPlacement({ placement, statusChange }) ? rule : null;
  }

  return null;
}

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

function addDays(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function getBusinessDateKey({ baseDate = new Date(), timeZone = HARASSMENT_TRAINING_TIME_ZONE } = {}) {
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

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return {
    startMs,
    endMs: startMs + DAY_MS,
    targetDate: dateKey,
  };
}

function buildDelayedStatusChangeDateKeys({ businessDateKey }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (dayOfWeek === 1) {
    return [addDays(businessDateKey, -3), addDays(businessDateKey, -2), addDays(businessDateKey, -1)];
  }

  if (dayOfWeek === 5) {
    return [addDays(businessDateKey, -1), businessDateKey];
  }

  return [addDays(businessDateKey, -1)];
}

function buildQueryPlan({ businessDateKey }) {
  return {
    businessDate: businessDateKey,
    dateBeginDateKeys: [businessDateKey],
    statusChangeDateKeys: buildDelayedStatusChangeDateKeys({ businessDateKey }),
  };
}

function buildResponseToken({ placement, rule, answer, secret }) {
  if (!secret) {
    return "";
  }

  const payload = {
    placementId: placement?.id ?? null,
    candidateId: placement?.candidate?.id ?? null,
    candidateEmail: normalizeString(placement?.candidate?.email).toLowerCase(),
    state: rule.stateLabel,
    questionId: "reviewed-attached-document",
    answer,
    issuedAt: new Date().toISOString(),
  };
  const payloadText = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payloadText).digest("base64url");
  return `${payloadText}.${signature}`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyResponseToken({ token, secret, expectedAnswer = null }) {
  if (!secret) {
    throw new Error("Missing HARASSMENT_TRAINING_RESPONSE_SIGNING_SECRET");
  }

  const [payloadText, signature] = normalizeString(token).split(".");
  if (!payloadText || !signature) {
    throw new Error("Invalid response token");
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(payloadText).digest("base64url");
  if (!safeEqual(signature, expectedSignature)) {
    throw new Error("Invalid response token signature");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid response token payload");
  }

  const answer = normalizeLower(payload?.answer);
  if (!["yes", "no"].includes(answer)) {
    throw new Error("Invalid response answer");
  }

  if (expectedAnswer && answer !== normalizeLower(expectedAnswer)) {
    throw new Error("Response answer does not match token");
  }

  return {
    placementId: payload.placementId ?? null,
    candidateId: payload.candidateId ?? null,
    candidateEmail: normalizeString(payload.candidateEmail).toLowerCase() || null,
    state: normalizeString(payload.state),
    questionId: normalizeString(payload.questionId) || "reviewed-attached-document",
    answer,
    issuedAt: normalizeString(payload.issuedAt) || null,
  };
}

function buildResponseUrl({ placement, rule, answer, config }) {
  const baseUrl = normalizeString(config.HARASSMENT_TRAINING_RESPONSE_BASE_URL);
  if (!baseUrl) {
    return "";
  }

  const token = buildResponseToken({
    placement,
    rule,
    answer,
    secret: config.HARASSMENT_TRAINING_RESPONSE_SIGNING_SECRET,
  });
  const url = new URL(baseUrl);
  url.searchParams.set("placementId", normalizeString(placement?.id));
  url.searchParams.set("state", rule.stateLabel);
  url.searchParams.set("questionId", "reviewed-attached-document");
  url.searchParams.set("answer", answer);
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

function buildSubject(rule) {
  if (rule.templateVariant === "onboarding-confirmation") {
    return `${rule.stateLabel} Anti Harassment Training`;
  }

  return `Notice: ${rule.stateLabel} Sexual Harassment Training needs to be completed`;
}

function buildBodyText({ placement, rule }) {
  const candidateFirstName = normalizeString(placement?.candidate?.firstName);
  const clientName = normalizeString(placement?.clientCorporation?.name);

  if (rule.templateVariant === "onboarding-confirmation") {
    return [
      `Hi ${candidateFirstName},`,
      "",
      `Congratulations on starting your new role with ${clientName}!`,
      "",
      "Please confirm you have reviewed the attached document?",
      "",
      "If you would like to take a more interactive course on this topic, Traliant provides one for free. Please visit the link in this email and provide your information, select Maine as the state and it will direct you to a video on Preventing Harassment in the workplace.",
      "",
      "Thanks for choosing to work with Spencer Ogden.",
    ].join("\n");
  }

  if (rule.templateVariant === "california-training-notice") {
    return [
      `Dear ${candidateFirstName},`,
      "",
      `Our records show you are beginning an assignment in ${rule.stateLabel}. The State of ${rule.stateLabel} has mandated that all employees must complete Sexual Harassment Prevention Training within 30 days of the start of their employment.`,
      "",
      `The training can be accessed through the following link: ${rule.trainingUrl}`,
      "",
      "At the completion of your training, please download the certificate and email it back.",
    ].join("\n");
  }

  return [
    `Dear ${candidateFirstName},`,
    "",
    `Our records show you are currently on assignment in ${rule.stateLabel}. The State of ${rule.stateLabel} has provided the documents attached and a training course to assist employees in gaining a better understanding of harassment and its forms.`,
    "",
    `Information regarding the training can be accessed through the following link: ${rule.trainingUrl}`,
    "",
    "At the completion of your training, please download the certificate and email it back.",
  ].join("\n");
}

function buildSubstitutionData({ placement, rule, config }) {
  const owner = placement?.candidate?.owner || placement?.jobOrder?.owner || {};
  const responseUrlYes = rule.requiresConfirmation
    ? buildResponseUrl({ placement, rule, answer: "yes", config })
    : "";
  const responseUrlNo = rule.requiresConfirmation
    ? buildResponseUrl({ placement, rule, answer: "no", config })
    : "";

  return {
    workflow_name: rule.workflowLabel,
    template_variant: rule.templateVariant,
    subject: buildSubject(rule),
    state: rule.stateLabel,
    placement_id: normalizeString(placement?.id),
    candidate_first_name: normalizeString(placement?.candidate?.firstName),
    candidate_last_name: normalizeString(placement?.candidate?.lastName),
    candidate_name: buildFullName(placement?.candidate),
    candidate_email: normalizeString(placement?.candidate?.email),
    candidate_owner_first_name: normalizeString(owner?.firstName),
    candidate_owner_name: buildFullName(owner),
    candidate_owner_email: normalizeString(owner?.email),
    client_company_name: normalizeString(placement?.clientCorporation?.name),
    requires_confirmation: rule.requiresConfirmation,
    confirmation_question_text: rule.requiresConfirmation
      ? "Please confirm you have reviewed the attached document?"
      : "",
    response_url_yes: responseUrlYes,
    response_url_no: responseUrlNo,
    training_url: normalizeString(rule.trainingUrl),
    body_text: buildBodyText({ placement, rule }),
  };
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

function buildRecipientEnvelope({ placement }) {
  const toEmail = normalizeLower(placement?.candidate?.email);
  const ownerEmail = normalizeLower(placement?.candidate?.owner?.email || placement?.jobOrder?.owner?.email);
  const ccEmails = uniqueEmails(["onboarding@spencer-ogden.com"], { exclude: [toEmail] });

  return {
    toEmail,
    ownerEmail,
    ccEmails,
    missingCandidateEmail: !toEmail,
    missingOwnerEmail: !ownerEmail,
  };
}

function buildHarassmentTrainingTransmission({ placement, rule, templateId, config, attachments = [] }) {
  const recipientEnvelope = buildRecipientEnvelope({ placement });
  const substitutionData = buildSubstitutionData({ placement, rule, config });
  const fromEmail =
    recipientEnvelope.ownerEmail ||
    normalizeLower(config.HARASSMENT_TRAINING_FALLBACK_FROM_EMAIL) ||
    "onboarding@spencer-ogden.com";

  const recipients = [
    {
      address: {
        email: recipientEnvelope.toEmail,
      },
      substitution_data: substitutionData,
    },
    ...recipientEnvelope.ccEmails.map((email) => ({
      address: {
        email,
        header_to: recipientEnvelope.toEmail,
      },
      substitution_data: substitutionData,
    })),
  ].filter((recipient) => normalizeString(recipient?.address?.email));

  return {
    templateId,
    recipients,
    from: {
      name: "Spencer Ogden",
      email: fromEmail,
    },
    headers: recipientEnvelope.ccEmails.length > 0
      ? {
          CC: recipientEnvelope.ccEmails.join(", "),
        }
      : undefined,
    attachments,
    recipientEnvelope,
  };
}

function getAttachmentPaths({ config, rule }) {
  return normalizeString(config?.[rule.attachmentConfigKey])
    .split(",")
    .map((configuredPath) => normalizeString(configuredPath))
    .filter(Boolean)
    .map((configuredPath) => path.resolve(configuredPath));
}

function buildAttachmentName(filePath) {
  return path.basename(filePath);
}

function buildPlacementReportRecord({
  placement,
  rule,
  templateId,
  businessDateKey,
  source,
  queryDate,
  statusChange = null,
  transactionId = null,
  recipientEnvelope,
  sparkPostPayload,
  attachmentPaths = [],
}) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    source,
    queryDate,
    transactionId,
    statusChange: statusChange
      ? {
          oldValue: statusChange.oldValue ?? null,
          newValue: statusChange.newValue ?? null,
        }
      : null,
    rule: {
      key: rule.key,
      state: rule.stateLabel,
      workflowLabel: rule.workflowLabel,
      templateVariant: rule.templateVariant,
      requiresConfirmation: rule.requiresConfirmation,
      templateId,
    },
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
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
      missingOwnerEmail: recipientEnvelope.missingOwnerEmail,
    },
    attachmentPaths,
    sparkPostPayload,
  };
}

module.exports = {
  HARASSMENT_TRAINING_TIME_ZONE,
  STATE_RULES,
  buildHarassmentTrainingTransmission,
  buildPlacementReportRecord,
  buildResponseToken,
  buildQueryPlan,
  buildUtcDayWindowFromDateKey,
  findRuleForPlacement,
  getAttachmentPaths,
  getBusinessDateKey,
  getIllinoisMaineMatchDetails,
  getPlacementCountry,
  getPlacementWorkState,
  hasHarassmentTrainingFlag,
  matchesCaliforniaPlacement,
  matchesConnecticutNewYorkPlacement,
  matchesIllinoisMainePlacement,
  verifyResponseToken,
  buildAttachmentName,
};
