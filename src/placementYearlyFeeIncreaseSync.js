require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const { SparkPostClient } = require("./sparkPostClient");
const {
  buildPlacementYearlyFeeIncreaseRecipient,
  buildUtcMonthOffsetDayWindow,
  matchesYearlyFeeIncreasePlacement,
} = require("./placementYearlyFeeIncreaseUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("./workflowRuntime");

function getTemplateId(config) {
  return config.PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID || config.SPARKPOST_TEMPLATE_ID || null;
}

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  if (!getTemplateId(config)) {
    missing.push("PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID or SPARKPOST_TEMPLATE_ID");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "placement-yearly-fee-increase-report", payload: report });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "placement-yearly-fee-increase-sparkpost-payload",
    payload,
  });
}

async function run() {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const templateId = getTemplateId(config);
  const effectiveWindowBeforeDays =
    config.PLACEMENT_YEARLY_FEE_INCREASE_TEST_MODE &&
    config.PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_BEFORE_DAYS === 0
      ? 3
      : config.PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_BEFORE_DAYS;
  const effectiveWindowAfterDays =
    config.PLACEMENT_YEARLY_FEE_INCREASE_TEST_MODE &&
    config.PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_AFTER_DAYS === 0
      ? 3
      : config.PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_AFTER_DAYS;

  const window = buildUtcMonthOffsetDayWindow({
    monthOffset: config.PLACEMENT_YEARLY_FEE_INCREASE_MONTH_OFFSET,
    windowBeforeDays: effectiveWindowBeforeDays,
    windowAfterDays: effectiveWindowAfterDays,
  });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      testMode: config.PLACEMENT_YEARLY_FEE_INCREASE_TEST_MODE,
      monthOffset: config.PLACEMENT_YEARLY_FEE_INCREASE_MONTH_OFFSET,
      windowBeforeDays: effectiveWindowBeforeDays,
      windowAfterDays: effectiveWindowAfterDays,
      targetPlacementDateBegin: window.targetPlacementDateBegin,
      startMs: window.startMs,
      endMs: window.endMs,
      queryCount: config.PLACEMENT_YEARLY_FEE_INCREASE_QUERY_COUNT,
      sparkPostTemplateId: templateId,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting placement yearly fee increase sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const placements = await bullhorn.queryPlacementsByDateBeginRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: window.startMs,
    endMs: window.endMs,
    count: config.PLACEMENT_YEARLY_FEE_INCREASE_QUERY_COUNT,
  });

  logger.info({ placementCount: placements.length }, "Fetched placements for yearly fee increase window");

  let skippedNonMatchingPlacement = 0;
  let skippedMissingOwnerId = 0;
  let skippedMissingOwnerEmail = 0;
  const matchedPlacements = [];
  const sparkPostRecipients = [];
  const ownerCache = new Map();

  for (const placement of placements) {
    if (!matchesYearlyFeeIncreasePlacement(placement, { testMode: config.PLACEMENT_YEARLY_FEE_INCREASE_TEST_MODE })) {
      skippedNonMatchingPlacement += 1;
      continue;
    }

    const ownerId = placement?.jobOrder?.owner?.id || null;
    if (!ownerId) {
      skippedMissingOwnerId += 1;
      continue;
    }

    let owner = ownerCache.get(ownerId);
    if (!owner) {
      owner = await bullhorn.getCorporateUser({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        corporateUserId: ownerId,
      });
      ownerCache.set(ownerId, owner);
    }

    if (!owner?.email) {
      skippedMissingOwnerEmail += 1;
      continue;
    }

    const sparkPostRecipient = buildPlacementYearlyFeeIncreaseRecipient({
      placement,
      owner,
      recipientEmail: owner.email,
    });

    sparkPostRecipients.push(sparkPostRecipient);
    matchedPlacements.push({
      placementId: placement.id,
      owner: {
        id: owner.id,
        firstName: owner.firstName || null,
        lastName: owner.lastName || null,
        email: owner.email,
      },
      placement: {
        id: placement.id,
        employmentType: placement.employmentType || null,
        dateBegin: placement.dateBegin || null,
        dateEnd: placement.dateEnd || null,
        candidate: placement.candidate || null,
        clientCorporation: placement.clientCorporation || null,
        jobOrder: placement.jobOrder || null,
      },
      sparkPostRecipient,
    });
  }

  let transmission = null;
  const sparkPostPayload = {
    content: {
      template_id: templateId,
    },
    recipients: sparkPostRecipients,
  };

  if (!config.DRY_RUN && sparkPostRecipients.length > 0) {
    transmission = await sparkPost.sendTransmission({
      templateId,
      recipients: sparkPostRecipients,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    window: {
      monthOffset: config.PLACEMENT_YEARLY_FEE_INCREASE_MONTH_OFFSET,
      windowBeforeDays: effectiveWindowBeforeDays,
      windowAfterDays: effectiveWindowAfterDays,
      targetPlacementDateBegin: window.targetPlacementDateBegin,
      startMs: window.startMs,
      endMs: window.endMs,
    },
    totals: {
      totalPlacements: placements.length,
      matchedPlacements: matchedPlacements.length,
      recipients: sparkPostRecipients.length,
      skippedNonMatchingPlacement,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
    },
    sparkPost: {
      templateId,
      recipientCount: sparkPostRecipients.length,
      sent: !config.DRY_RUN && sparkPostRecipients.length > 0,
      transmission,
      payload: sparkPostPayload,
    },
    recipients: sparkPostRecipients,
    placements: matchedPlacements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: sparkPostPayload });
  logger.info({ reportPath }, "Placement yearly fee increase report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "Placement yearly fee increase SparkPost payload report written",
  );

  return buildWorkflowResult({
    workflowName: "placement-yearly-fee-increase-sync",
    report,
    artifacts: {
      reportPath,
      sparkPostPayloadReportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Placement yearly fee increase sync failed");
    process.exitCode = 1;
  });
}

module.exports = { getTemplateId, run, writeSparkPostPayloadReport };
