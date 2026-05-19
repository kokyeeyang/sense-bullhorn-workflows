require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  releaseWorkflowSend,
  reserveWorkflowSend,
} = require("../stores/workflowSendLockStore");
const {
  WORKFLOW_NAME,
  buildDateAddedQueryDates,
  buildPlacementReportRecord,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
  matchesPlacement,
} = require("../utils/vestasPoUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "dateAdded",
  "dateBegin",
  "salary",
  "flatFee",
  "owner(id,firstName,lastName,email)",
  "candidate(id,firstName,lastName,email,address(countryName))",
  "clientCorporation(id,name,address(countryName))",
  "clientContact(id,firstName,lastName,email)",
  "billingClientContact(id,firstName,lastName,email)",
  "jobOrder(id,title,address(countryName),owner(id,firstName,lastName,email))",
].join(",");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) {
    missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
  if (!config.WORKFLOW_SURVEY_RESPONSE_BASE_URL) {
    missing.push("WORKFLOW_SURVEY_RESPONSE_BASE_URL");
  }
  if (!config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET) {
    missing.push("WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required Vestas PO config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "vestas-po-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "vestas-po-sparkpost-payload",
    payload,
  });
}

function buildSkippedPlacementPreview({ placement, queryDateAdded, reason, matchDetails = null, sendLock = null }) {
  return {
    placementId: placement?.id ?? null,
    queryDateAdded,
    reason,
    matchDetails,
    sendLock,
    placement: {
      id: placement?.id ?? null,
      dateAdded: placement?.dateAdded || null,
      dateBegin: placement?.dateBegin || null,
      clientCorporation: placement?.clientCorporation || null,
      owner: placement?.owner || placement?.jobOrder?.owner || null,
      candidate: placement?.candidate || null,
    },
  };
}

async function hydrateOwner({ bullhorn, session, placement, ownerCache }) {
  const ownerId = placement?.owner?.id || placement?.jobOrder?.owner?.id || null;
  if (!ownerId) {
    return placement;
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

  if (placement?.owner?.id) {
    return {
      ...placement,
      owner: {
        ...placement.owner,
        ...owner,
      },
    };
  }

  return {
    ...placement,
    jobOrder: {
      ...placement.jobOrder,
      owner: {
        ...placement?.jobOrder?.owner,
        ...owner,
      },
    },
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const configuredTargetDate = config.VESTAS_PO_TARGET_DATE || null;
  const businessDateKey = targetDate || configuredTargetDate || business.dateKey;
  const forceTimedRun = Boolean(targetDate || configuredTargetDate);

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      dayOfWeek: business.dayOfWeek,
      queryCount: config.VESTAS_PO_QUERY_COUNT,
    },
    "Starting Vestas PO sync",
  );

  if (!isTimedRuleDue({ businessHour: business.hour, dayOfWeek: business.dayOfWeek, force: forceTimedRun })) {
    const report = {
      generatedAt: new Date().toISOString(),
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      skippedReason: business.dayOfWeek === 0 || business.dayOfWeek === 6
        ? "outside-pacific-weekday"
        : "outside-send-hour",
      queryDates: [],
      totals: {
        totalPlacementsQueried: 0,
        matchedPlacements: 0,
      },
      sparkPost: {
        sent: false,
        transmissionCount: 0,
        payloadCount: 0,
        transmissions: [],
        payload: [],
      },
      placements: [],
      skippedPlacements: [],
    };

    const reportPath = await writeChangesReport({ report });
    const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: [] });
    return buildWorkflowResult({
      workflowName: WORKFLOW_NAME,
      report,
      artifacts: { reportPath, sparkPostPayloadReportPath },
    });
  }

  const queryDates = forceTimedRun
    ? [businessDateKey]
    : buildDateAddedQueryDates({ businessDateKey });
  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const queriedPlacements = [];
  const seenPlacementIds = new Set();

  for (const queryDateAdded of queryDates) {
    const window = buildUtcDayWindowFromDateKey(queryDateAdded);
    const placements = await bullhorn.queryPlacementsByDateAddedRange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      startMs: window.startMs,
      endMs: window.endMs,
      count: config.VESTAS_PO_QUERY_COUNT,
      fieldsOverride: PLACEMENT_FIELDS,
    });

    for (const placement of placements) {
      if (seenPlacementIds.has(placement.id)) {
        continue;
      }
      seenPlacementIds.add(placement.id);
      queriedPlacements.push({ placement, queryDateAdded });
    }
  }

  const ownerCache = new Map();
  const matchedPlacements = [];
  const skippedPlacements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedNonMatchingPlacement = 0;
  let skippedMissingOwnerEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of queriedPlacements) {
    const placement = await hydrateOwner({
      bullhorn,
      session,
      placement: item.placement,
      ownerCache,
    });
    const matchDetails = getMatchDetails(placement);

    if (!matchesPlacement(placement)) {
      skippedNonMatchingPlacement += 1;
      skippedPlacements.push(buildSkippedPlacementPreview({
        placement,
        queryDateAdded: item.queryDateAdded,
        reason: "placement-not-eligible",
        matchDetails,
      }));
      continue;
    }

    const transmissionPayload = buildTransmission({ placement, config });
    if (transmissionPayload.recipientEnvelope.missingOwnerEmail) {
      skippedMissingOwnerEmail += 1;
      skippedPlacements.push(buildSkippedPlacementPreview({
        placement,
        queryDateAdded: item.queryDateAdded,
        reason: "missing-owner-email",
        matchDetails,
      }));
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    const sendLockEntityId = String(placement.id);
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement",
        entityId: sendLockEntityId,
        metadata: {
          businessDate: businessDateKey,
          queryDateAdded: item.queryDateAdded,
          candidateId: placement?.candidate?.id || null,
        },
      });

      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        skippedPlacements.push(buildSkippedPlacementPreview({
          placement,
          queryDateAdded: item.queryDateAdded,
          reason: "already-sent",
          matchDetails,
          sendLock,
        }));
        continue;
      }
      if (sendLock.skipped) {
        sendLockUnavailable += 1;
      }
    }

    const placementReportRecord = buildPlacementReportRecord({
      placement,
      queryDateAdded: item.queryDateAdded,
      businessDateKey,
      recipientEnvelope: transmissionPayload.recipientEnvelope,
      sparkPostPayload: transmissionPayload,
      sendLock,
    });

    matchedPlacements.push(placementReportRecord);
    sparkPostPayload.push(transmissionPayload);

    if (!config.DRY_RUN) {
      try {
        const transmission = await sparkPost.sendInlineTransmission({
          content: transmissionPayload.content,
          recipients: transmissionPayload.recipients,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "notification",
            recipientType: "owner",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            placementId: placement?.id || null,
            candidateId: placement?.candidate?.id || null,
            clientCorporationId: placement?.clientCorporation?.id || null,
            ownerId: placement?.owner?.id || placement?.jobOrder?.owner?.id || null,
            ownerEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            businessDate: businessDateKey,
            runDate: businessDateKey,
            context: {
              queryDateAdded: item.queryDateAdded,
            },
            metadata: {
              surveyQuestionId: "vestas-po-turnaround-time",
            },
          },
        });
        transmissions.push({ placementId: placement.id, transmission });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "placement",
            entityId: sendLockEntityId,
          }).catch((releaseError) => {
            logger.warn(
              { message: releaseError.message, placementId: placement.id },
              "Failed to release Vestas PO send lock",
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
    businessHour: business.hour,
    queryDates,
    totals: {
      totalPlacementsQueried: queriedPlacements.length,
      matchedPlacements: matchedPlacements.length,
      skippedNonMatchingPlacement,
      skippedMissingOwnerEmail,
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
    skippedPlacements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: sparkPostPayload });
  logger.info({ reportPath }, "Vestas PO report written");
  logger.info({ sparkPostPayloadReportPath }, "Vestas PO SparkPost payload report written");

  return buildWorkflowResult({
    workflowName: WORKFLOW_NAME,
    report,
    artifacts: { reportPath, sparkPostPayloadReportPath },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Vestas PO sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  run,
};
