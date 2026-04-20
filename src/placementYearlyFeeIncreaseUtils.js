const { buildFullName, formatDateBegin, normalizeString } = require("./placementStartReminderUtils");

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function buildUtcMonthOffsetDayWindow({
  baseDate = new Date(),
  monthOffset = 11,
  windowBeforeDays = 0,
  windowAfterDays = 0,
} = {}) {
  const targetDayStart = Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth() - monthOffset,
    baseDate.getUTCDate(),
    0,
    0,
    0,
    0,
  );

  return {
    startMs: targetDayStart - windowBeforeDays * 24 * 60 * 60 * 1000,
    endMs: targetDayStart + (windowAfterDays + 1) * 24 * 60 * 60 * 1000,
    targetPlacementDateBegin: new Date(targetDayStart).toISOString().slice(0, 10),
    monthOffset,
    windowBeforeDays,
    windowAfterDays,
  };
}

function hasValue(value) {
  return normalizeString(value) !== "";
}

function isYearlyFeeIncreaseValue(value) {
  const normalized = normalizeString(value);
  return /^(10|[1-9])$/.test(normalized);
}

function isContractEmploymentType(value) {
  return normalizeLower(value) === "contract";
}

function isDateAfterTodayUtc(value, { baseDate = new Date() } = {}) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  const todayStart = Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    0,
    0,
    0,
    0,
  );

  return parsed.getTime() > todayStart;
}

function matchesYearlyFeeIncreasePlacement(placement, { baseDate = new Date(), testMode = false } = {}) {
  // In test mode, only require contract employment type and future end date
  // This allows testing with existing contract placements that don't have the full criteria set up
  if (testMode) {
    return (
      isContractEmploymentType(placement?.employmentType) &&
      isDateAfterTodayUtc(placement?.dateEnd, { baseDate })
    );
  }

  // Production criteria: require all conditions
  return (
    isContractEmploymentType(placement?.employmentType) &&
    hasValue(placement?.clientCorporation?.customDate1) &&
    isYearlyFeeIncreaseValue(placement?.clientCorporation?.billingFrequency) &&
    isDateAfterTodayUtc(placement?.dateEnd, { baseDate })
  );
}

function buildPlacementYearlyFeeIncreaseRecipient({ placement, owner, recipientEmail }) {
  return {
    address: {
      email: recipientEmail,
    },
    substitution_data: {
      owner_firstName: buildFullName(owner),
      client_company_name: normalizeString(placement?.clientCorporation?.name),
      yearly_fee_increase_percent: normalizeString(placement?.clientCorporation?.billingFrequency),
      placement_id: normalizeString(placement?.id),
      candidate_name: buildFullName(placement?.candidate),
      placement_start_date: formatDateBegin(placement?.dateBegin),
      placement_end_date: formatDateBegin(placement?.dateEnd),
      job_title: normalizeString(placement?.jobOrder?.title),
      tob_date: formatDateBegin(placement?.clientCorporation?.customDate1),
    },
  };
}

module.exports = {
  buildPlacementYearlyFeeIncreaseRecipient,
  buildUtcMonthOffsetDayWindow,
  hasValue,
  isContractEmploymentType,
  isDateAfterTodayUtc,
  isYearlyFeeIncreaseValue,
  matchesYearlyFeeIncreasePlacement,
};
