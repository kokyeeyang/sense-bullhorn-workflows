require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const { SparkPostClient } = require("./sparkPostClient");
const {
  buildDateBeginQueryDates,
  buildPerformanceCheckinTransmission,
  buildPlacementReportRecord,
  buildUtcDayWindowFromDateKey,
  getBusinessDateKey,
  matchesPerformanceCheckinPlacement,
} = require("./usContractPerformanceCheckinUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("./workflowRuntime");
const {
  releaseWorkflowSend,
  reserveWorkflowSend,
} = require("./workflowSendLockStore");

const WORKFLOW_NAME = "us-contract-performance-checkin-sync";

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "employmentType",
  "owner(id,firstName,lastName,email,pager)",
  "candidate(id,firstName,lastName,email)",
  "clientContact(id,firstName,lastName,email)",
  "billingClientContact(id,firstName,lastName,email)",
  "clientCorporation(id,name,customText16)",
  "jobOrder(id,title,owner(id,firstName,lastName,email,pager,reportToPerson(id,firstName,lastName,email)))",
].join(",");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) {
    missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "us-contract-performance-checkin-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "us-contract-performance-checkin-sparkpost-payload",
    payload,
  });
}

async function hydrateJobOrderOwner({ bullhorn, session, placement, ownerCache }) {
  const jobOrderOwnerId = placement?.jobOrder?.owner?.id || null;
  if (!jobOrderOwnerId) {
    return placement;
  }

  let jobOrderOwner = ownerCache.get(jobOrderOwnerId);
  if (!jobOrderOwner) {
    jobOrderOwner = await bullhorn.getCorporateUser({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      corporateUserId: jobOrderOwnerId,
    });
    ownerCache.set(jobOrderOwnerId, jobOrderOwner);
  }

  return {
    ...placement,
    jobOrder: {
      ...placement.jobOrder,
      owner: {
        ...placement?.jobOrder?.owner,
        ...jobOrderOwner,
      },
    },
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const businessDateKey = targetDate || getBusinessDateKey();
  const queryDateBeginDates = buildDateBeginQueryDates({ businessDateKey });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      queryDateBeginDates,
      queryCount: config.US_CONTRACT_PERFORMANCE_CHECKIN_QUERY_COUNT,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting US contract performance check-in sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const queriedPlacements = [];
  const seenPlacementIds = new Set();

  for (const queryDateBegin of queryDateBeginDates) {
    const window = buildUtcDayWindowFromDateKey(queryDateBegin);
    const placements = await bullhorn.queryPlacementsByDateBeginRange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      startMs: window.startMs,
      endMs: window.endMs,
      count: config.US_CONTRACT_PERFORMANCE_CHECKIN_QUERY_COUNT,
      fieldsOverride: PLACEMENT_FIELDS,
    });

    for (const placement of placements) {
      if (seenPlacementIds.has(placement.id)) {
        continue;
      }

      seenPlacementIds.add(placement.id);
      queriedPlacements.push({
        queryDateBegin,
        placement,
      });
    }
  }

  logger.info(
    { placementCount: queriedPlacements.length },
    "Fetched placements for US contract performance check-in window",
  );

  let skippedNonMatchingPlacement = 0;
  let skippedMissingClientContactEmail = 0;
  let skippedMissingJobOrderOwnerEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;
  const ownerCache = new Map();
  const matchedPlacements = [];
  const sparkPostPayload = [];
  const transmissions = [];

  for (const item of queriedPlacements) {
    const placement = await hydrateJobOrderOwner({
      bullhorn,
      session,
      placement: item.placement,
      ownerCache,
    });

    if (!matchesPerformanceCheckinPlacement(placement)) {
      skippedNonMatchingPlacement += 1;
      continue;
    }

    const transmissionPayload = buildPerformanceCheckinTransmission({ placement });
    if (transmissionPayload.recipientEnvelope.missingClientContactEmail) {
      skippedMissingClientContactEmail += 1;
      continue;
    }
    if (transmissionPayload.recipientEnvelope.missingJobOrderOwnerEmail) {
      skippedMissingJobOrderOwnerEmail += 1;
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement",
        entityId: placement.id,
        metadata: {
          businessDate: businessDateKey,
          queryDateBegin: item.queryDateBegin,
          candidateId: placement?.candidate?.id || null,
        },
      });

      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        continue;
      }
      if (sendLock.skipped) {
        sendLockUnavailable += 1;
      }
    }

    const placementReportRecord = buildPlacementReportRecord({
      placement,
      businessDateKey,
      queryDateBegin: item.queryDateBegin,
      recipientEnvelope: transmissionPayload.recipientEnvelope,
      sparkPostPayload: transmissionPayload,
      sendLock,
    });

    matchedPlacements.push(placementReportRecord);
    sparkPostPayload.push(transmissionPayload);

    if (!config.DRY_RUN) {
      try {
        const transmission = await sparkPost.sendInlineTransmission(transmissionPayload);
        transmissions.push({
          placementId: placement.id,
          transmission,
        });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "placement",
            entityId: placement.id,
          }).catch((releaseError) => {
            logger.warn(
              { message: releaseError.message, placementId: placement.id },
              "Failed to release US contract performance check-in send lock",
            );
          });
        }
        throw error;
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    businessDate: businessDateKey,
    queryDateBeginDates,
    totals: {
      totalPlacementsQueried: queriedPlacements.length,
      matchedPlacements: matchedPlacements.length,
      skippedNonMatchingPlacement,
      skippedMissingClientContactEmail,
      skippedMissingJobOrderOwnerEmail,
      skippedAlreadySent,
      sendLockUnavailable,
    },
    sparkPost: {
      sent: !config.DRY_RUN && matchedPlacements.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    placements: matchedPlacements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: sparkPostPayload });
  logger.info({ reportPath }, "US contract performance check-in report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "US contract performance check-in SparkPost payload report written",
  );

  return buildWorkflowResult({
    workflowName: WORKFLOW_NAME,
    report,
    artifacts: {
      reportPath,
      sparkPostPayloadReportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "US contract performance check-in sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  WORKFLOW_NAME,
  run,
  writeSparkPostPayloadReport,
};
