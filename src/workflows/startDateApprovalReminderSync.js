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
  buildPlacementReportRecord,
  buildSkippedPlacementPreview,
  buildStageQueryPlan,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
  matchesPlacement,
  SKIPPED_PREVIEW_LIMIT,
  WORKFLOW_NAME,
} = require("../utils/startDateApprovalReminderUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "employmentType",
  "owner(id,firstName,lastName,email,pager,reportToPerson(id,firstName,lastName,email))",
  "candidate(id,firstName,lastName,email,address(countryName))",
  "clientCorporation(id,name,address(countryName))",
  "jobOrder(id,title,address(countryName),owner(id,firstName,lastName,email,pager,reportToPerson(id,firstName,lastName,email)))",
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
    filePrefix: "start-date-approval-reminder-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "start-date-approval-reminder-sparkpost-payload",
    payload,
  });
}

async function hydratePlacementOwners({ bullhorn, session, placement, ownerCache }) {
  const ownerIds = [placement?.owner?.id, placement?.jobOrder?.owner?.id].filter(Boolean);
  if (ownerIds.length === 0) {
    return placement;
  }

  const updates = {};

  for (const ownerId of ownerIds) {
    let owner = ownerCache.get(ownerId);
    if (!owner) {
      owner = await bullhorn.getCorporateUser({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        corporateUserId: ownerId,
      });
      ownerCache.set(ownerId, owner);
    }

    if (placement?.owner?.id === ownerId) {
      updates.owner = {
        ...placement.owner,
        ...owner,
      };
    }
    if (placement?.jobOrder?.owner?.id === ownerId) {
      updates.jobOrder = {
        ...placement.jobOrder,
        owner: {
          ...placement?.jobOrder?.owner,
          ...owner,
        },
      };
    }
  }

  return {
    ...placement,
    ...updates,
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig("start-date-approval-reminder-sync");
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey =
    targetDate || config.START_DATE_APPROVAL_REMINDER_TARGET_DATE || business.dateKey;
  const forceTimedRules = Boolean(targetDate || config.START_DATE_APPROVAL_REMINDER_TARGET_DATE);

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      queryCount: config.START_DATE_APPROVAL_REMINDER_QUERY_COUNT,
    },
    "Starting start date approval reminder sync",
  );

  if (!isTimedRuleDue({ businessHour: business.hour, force: forceTimedRules })) {
    const report = {
      generatedAt: new Date().toISOString(),
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      skippedReason: "outside-send-hour",
      totals: {
        totalPlacementsQueried: 0,
        matchedPlacements: 0,
      },
      placements: [],
      skippedPlacements: [],
    };

    const reportPath = await writeChangesReport({ report });
    const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: [] });

    return buildWorkflowResult({
      workflowName: WORKFLOW_NAME,
      report,
      artifacts: {
        reportPath,
        sparkPostPayloadReportPath,
      },
    });
  }

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const stagePlans = buildStageQueryPlan({ businessDateKey });
  const queriedPlacements = [];
  const seenStagePlacementKeys = new Set();

  for (const stage of stagePlans) {
    for (const queryDateBegin of stage.queryDateBeginDates) {
      const window = buildUtcDayWindowFromDateKey(queryDateBegin);
      const placements = await bullhorn.queryPlacementsByDateBeginRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: config.START_DATE_APPROVAL_REMINDER_QUERY_COUNT,
        fieldsOverride: PLACEMENT_FIELDS,
      });

      for (const placement of placements) {
        const dedupeKey = `${stage.key}:${placement.id}`;
        if (seenStagePlacementKeys.has(dedupeKey)) {
          continue;
        }

        seenStagePlacementKeys.add(dedupeKey);
        queriedPlacements.push({
          stage,
          queryDateBegin,
          placement,
        });
      }
    }
  }

  logger.info(
    { placementCount: queriedPlacements.length, stageCount: stagePlans.length },
    "Fetched placements for start date approval reminder window",
  );

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
    const placement = await hydratePlacementOwners({
      bullhorn,
      session,
      placement: item.placement,
      ownerCache,
    });

    const matchDetails = getMatchDetails(placement);
    if (!matchesPlacement(placement)) {
      skippedNonMatchingPlacement += 1;
      if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
        skippedPlacements.push(buildSkippedPlacementPreview({
          placement,
          stage: item.stage,
          queryDateBegin: item.queryDateBegin,
          reason: "placement-not-eligible",
          matchDetails,
        }));
      }
      continue;
    }

    const regionRule = require("../utils/startDateApprovalReminderUtils").REGION_RULES.find(
      (rule) => rule.label === matchDetails.region,
    );
    const transmissionPayload = buildTransmission({
      placement,
      stage: item.stage,
      regionRule,
      config,
    });

    if (transmissionPayload.recipientEnvelope.missingOwnerEmail) {
      skippedMissingOwnerEmail += 1;
      if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
        skippedPlacements.push(buildSkippedPlacementPreview({
          placement,
          stage: item.stage,
          queryDateBegin: item.queryDateBegin,
          reason: "missing-owner-email",
          matchDetails,
        }));
      }
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    const sendLockEntityId = `${placement.id}:${item.stage.key}`;
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement-stage",
        entityId: sendLockEntityId,
        metadata: {
          businessDate: businessDateKey,
          queryDateBegin: item.queryDateBegin,
          stageKey: item.stage.key,
          stageDaysAfterDateBegin: item.stage.daysAfterDateBegin,
          candidateId: placement?.candidate?.id || null,
        },
      });

      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
          skippedPlacements.push(buildSkippedPlacementPreview({
            placement,
            stage: item.stage,
            queryDateBegin: item.queryDateBegin,
            reason: "already-sent",
            matchDetails,
          }));
        }
        continue;
      }
      if (sendLock.skipped) {
        sendLockUnavailable += 1;
      }
    }

    const placementReportRecord = buildPlacementReportRecord({
      placement,
      stage: item.stage,
      regionRule,
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
        const transmission = await sparkPost.sendInlineTransmission({
          ...transmissionPayload,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "reminder",
            ruleKey: item.stage.key,
            recipientType: "owner",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            recipientFirstName:
              placement?.owner?.firstName ||
              placement?.jobOrder?.owner?.firstName ||
              "",
            placementId: placement?.id || null,
            candidateId: placement?.candidate?.id || null,
            clientCorporationId: placement?.clientCorporation?.id || null,
            ownerId: placement?.owner?.id || placement?.jobOrder?.owner?.id || null,
            ownerEmail:
              placement?.owner?.email ||
              placement?.jobOrder?.owner?.email ||
              "",
            businessDate: businessDateKey,
            runDate: businessDateKey,
            context: {
              queryDateBegin: item.queryDateBegin,
            },
            metadata: {
              stageKey: item.stage.key,
              stageDaysAfterDateBegin: item.stage.daysAfterDateBegin,
              region: matchDetails.region || null,
            },
          },
        });
        transmissions.push({
          placementId: placement.id,
          stageKey: item.stage.key,
          transmission,
        });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "placement-stage",
            entityId: sendLockEntityId,
          }).catch((releaseError) => {
            logger.warn(
              { message: releaseError.message, placementId: placement.id, stageKey: item.stage.key },
              "Failed to release start date approval reminder send lock",
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
    stagePlans,
    totals: {
      totalPlacementsQueried: queriedPlacements.length,
      matchedPlacements: matchedPlacements.length,
      skippedNonMatchingPlacement,
      skippedMissingOwnerEmail,
      skippedAlreadySent,
      sendLockUnavailable,
      skippedPreviewCount: skippedPlacements.length,
    },
    sparkPost: {
      sent: !config.DRY_RUN && matchedPlacements.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    skippedPlacements,
    placements: matchedPlacements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: sparkPostPayload });
  logger.info({ reportPath }, "Start date approval reminder report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "Start date approval reminder SparkPost payload report written",
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
    logger.error(serializeError(error), "Start date approval reminder sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  WORKFLOW_NAME,
  run,
};
