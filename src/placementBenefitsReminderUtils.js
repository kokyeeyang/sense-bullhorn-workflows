const { buildFullName, formatDateBegin, normalizeString } = require("./placementStartReminderUtils");

const BENEFITS_REMINDER_TIME_ZONE = "America/Los_Angeles";
const EXCLUDED_DEPARTMENTS = new Set(["hou - contract dc", "hou - dcm", "hou - dc"]);
const EXCLUDED_CLIENT_CORPORATION_IDS = new Set(["10397", "32", "7895", "4608", "56847"]);
const APPROVED_STATUS_VALUES = ["approved", "qc approved"];
const DAY_MS = 24 * 60 * 60 * 1000;

const BENEFITS_REMINDER_STAGES = [
  {
    key: "day10",
    label: "day-10",
    dayOffset: 10,
    templateConfigKey: "PLACEMENT_BENEFITS_REMINDER_DAY10_SPARKPOST_TEMPLATE_ID",
    includeCcRecipients: false,
  },
  {
    key: "day21",
    label: "day-21",
    dayOffset: 21,
    templateConfigKey: "PLACEMENT_BENEFITS_REMINDER_DAY21_SPARKPOST_TEMPLATE_ID",
    includeCcRecipients: true,
  },
  {
    key: "day26",
    label: "day-26",
    dayOffset: 26,
    templateConfigKey: "PLACEMENT_BENEFITS_REMINDER_DAY26_SPARKPOST_TEMPLATE_ID",
    includeCcRecipients: true,
  },
];

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

function getBusinessDateKey({ baseDate = new Date(), timeZone = BENEFITS_REMINDER_TIME_ZONE } = {}) {
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

function buildDateBeginQueryDatesForStage({ businessDateKey, stage }) {
  const dates = [addDays(businessDateKey, -stage.dayOffset)];
  const dayOfWeek = getDayOfWeek(businessDateKey);

  if (dayOfWeek === 5) {
    dates.push(addDays(businessDateKey, 1 - stage.dayOffset));
  } else if (dayOfWeek === 1) {
    dates.push(addDays(businessDateKey, -1 - stage.dayOffset));
  }

  return Array.from(new Set(dates));
}

function buildQueryPlan({ businessDateKey }) {
  return BENEFITS_REMINDER_STAGES.map((stage) => ({
    stageKey: stage.key,
    stageLabel: stage.label,
    dayOffset: stage.dayOffset,
    dateBeginDates: buildDateBeginQueryDatesForStage({ businessDateKey, stage }),
  }));
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

function matchesBenefitsReminderPlacement(placement) {
  const employmentType = normalizeLower(placement?.employmentType);
  const status = normalizeLower(placement?.status);
  const benefitPackage = normalizeLower(placement?.candidate?.benefitPackage);
  const candidateOwnerDepartment = normalizeLower(
    placement?.candidate?.owner?.primaryDepartment?.name,
  );
  const clientCorporationId = normalizeString(placement?.clientCorporation?.id);

  return (
    employmentType === "contract" &&
    APPROVED_STATUS_VALUES.some((value) => status.includes(value)) &&
    benefitPackage === "benefit eligible" &&
    !EXCLUDED_DEPARTMENTS.has(candidateOwnerDepartment) &&
    !EXCLUDED_CLIENT_CORPORATION_IDS.has(clientCorporationId)
  );
}

function getStageTemplateId({ config, stage }) {
  return config?.[stage.templateConfigKey] || null;
}

function uniqueEmails(values, { exclude = [] } = {}) {
  const excludeSet = new Set(exclude.map((value) => normalizeLower(value)).filter(Boolean));
  const seen = new Set();
  const emails = [];

  for (const value of values) {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized || excludeSet.has(normalized) || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    emails.push(normalized);
  }

  return emails;
}

function buildBenefitsReminderRecipientEnvelope({ placement, stage }) {
  const toEmail = normalizeString(placement?.candidate?.email).toLowerCase();
  const candidateOwnerEmail = normalizeString(placement?.candidate?.owner?.email).toLowerCase();
  const jobOrderOwnerEmail = normalizeString(placement?.jobOrder?.owner?.email).toLowerCase();
  const ccEmails = stage.includeCcRecipients
    ? uniqueEmails([jobOrderOwnerEmail, candidateOwnerEmail], { exclude: [toEmail] })
    : [];

  return {
    toEmail,
    ccEmails,
    missingCandidateEmail: !toEmail,
    missingCandidateOwnerEmail: stage.includeCcRecipients && !candidateOwnerEmail,
    missingJobOrderOwnerEmail: stage.includeCcRecipients && !jobOrderOwnerEmail,
  };
}

function buildBenefitsReminderTransmission({ placement, stage, templateId }) {
  const recipientEnvelope = buildBenefitsReminderRecipientEnvelope({ placement, stage });
  const substitutionData = {
    candidate_first_name: normalizeString(placement?.candidate?.firstName),
    candidate_name: buildFullName(placement?.candidate),
    placement_id: normalizeString(placement?.id),
    placement_start_date: formatDateBegin(placement?.dateBegin),
    reminder_stage: stage.label,
    reminder_day_offset: String(stage.dayOffset),
  };

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
    headers: recipientEnvelope.ccEmails.length > 0
      ? { CC: recipientEnvelope.ccEmails.join(", ") }
      : undefined,
    recipientEnvelope,
  };
}

function buildPlacementReportRecord({
  placement,
  stage,
  templateId,
  queryDateBegin,
  businessDateKey,
  recipientEnvelope,
  sparkPostPayload,
}) {
  return {
    placementId: placement?.id ?? null,
    stage: {
      key: stage.key,
      label: stage.label,
      dayOffset: stage.dayOffset,
      templateId,
    },
    businessDate: businessDateKey,
    queryDateBegin,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || null,
      dateBegin: placement?.dateBegin || null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
    recipient: {
      toEmail: recipientEnvelope.toEmail || null,
      ccEmails: recipientEnvelope.ccEmails,
      missingCandidateOwnerEmail: recipientEnvelope.missingCandidateOwnerEmail,
      missingJobOrderOwnerEmail: recipientEnvelope.missingJobOrderOwnerEmail,
    },
    sparkPostPayload,
  };
}

module.exports = {
  BENEFITS_REMINDER_STAGES,
  BENEFITS_REMINDER_TIME_ZONE,
  buildBenefitsReminderRecipientEnvelope,
  buildBenefitsReminderTransmission,
  buildDateBeginQueryDatesForStage,
  buildPlacementReportRecord,
  buildQueryPlan,
  buildUtcDayWindowFromDateKey,
  getBusinessDateKey,
  getStageTemplateId,
  matchesBenefitsReminderPlacement,
};
