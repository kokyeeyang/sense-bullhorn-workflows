require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  QUERY_COUNT_DEFAULT,
  REMINDER_STAGES,
  SEND_AT_PACIFIC_HOUR,
  WORKFLOW_NAME,
  buildQueryPlan,
  buildReportRecord,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  matchesPlacement,
} = require("../utils/placementEndDateReminderUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "dateEnd",
  "employmentType",
  "candidate(id,firstName,lastName,email)",
  "clientCorporation(id,name)",
  "clientContact(id,firstName,lastName,companyName,clientCorporation(id,name))",
  "billingClientContact(id,firstName,lastName,companyName,clientCorporation(id,name))",
  "jobOrder(id,title,employmentType,assignedUser(id,firstName,lastName,email),owner(id,firstName,lastName,email,reportToPerson(id,firstName,lastName,email)))",
].join(",");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) return;
  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "placement-end-date-reminder-report", payload: report });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "placement-end-date-reminder-sparkpost-payload",
    payload,
  });
}

async function hydrateJobOrderOwner({ bullhorn, session, placement, ownerCache }) {
  const ownerId = placement?.jobOrder?.owner?.id || null;
  if (!ownerId) return placement;
  if (!ownerCache.has(ownerId)) {
    ownerCache.set(ownerId, await bullhorn.getCorporateUser({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      corporateUserId: ownerId,
    }));
  }
  return {
    ...placement,
    jobOrder: {
      ...placement?.jobOrder,
      owner: {
        ...placement?.jobOrder?.owner,
        ...ownerCache.get(ownerId),
      },
    },
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig("placement-end-date-reminder-sync");
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const configuredTargetDate = config.PLACEMENT_END_DATE_REMINDER_TARGET_DATE || null;
  const businessDateKey = targetDate || configuredTargetDate || business.dateKey;
  const forceTimedRun = Boolean(targetDate || configuredTargetDate);
  const queryPlan = buildQueryPlan({ businessDateKey });

  if (!forceTimedRun && business.hour !== SEND_AT_PACIFIC_HOUR) {
    const report = {
      generatedAt: new Date().toISOString(),
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      expectedPacificHour: SEND_AT_PACIFIC_HOUR,
      skippedReason: "outside-send-hour",
      queryPlan,
      totals: {
        totalPlacementsQueried: 0,
        matchedPlacements: 0,
        skippedNonMatchingPlacement: 0,
        skippedMissingToEmail: 0,
        skippedDuplicate: 0,
        skippedAlreadySent: 0,
        sendLockUnavailable: 0,
      },
      sparkPost: { sent: false, transmissionCount: 0, payloadCount: 0, transmissions: [], payload: [] },
      placements: [],
    };
    const reportPath = await writeChangesReport({ report });
    const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: [] });
    return buildWorkflowResult({
      workflowName: WORKFLOW_NAME,
      report,
      artifacts: { reportPath, sparkPostPayloadReportPath },
    });
  }

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      queryCount: config.PLACEMENT_END_DATE_REMINDER_QUERY_COUNT || QUERY_COUNT_DEFAULT,
      queryPlan,
    },
    "Starting placement end date reminder sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const stagePlacements = [];
  const seenQueryKeys = new Set();

  for (const plan of queryPlan) {
    const stage = REMINDER_STAGES.find((item) => item.key === plan.stageKey);
    for (const queryDate of plan.dateEndDates) {
      const window = buildUtcDayWindowFromDateKey(queryDate);
      const placements = await bullhorn.queryPlacementsByDateEndRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: config.PLACEMENT_END_DATE_REMINDER_QUERY_COUNT || QUERY_COUNT_DEFAULT,
        fieldsOverride: PLACEMENT_FIELDS,
      });

      for (const placement of placements) {
        const key = `${stage.key}:${placement.id}:${queryDate}`;
        if (seenQueryKeys.has(key)) continue;
        seenQueryKeys.add(key);
        stagePlacements.push({ stage, queryDate, placement });
      }
    }
  }

  const matchedPlacements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  const ownerCache = new Map();
  const seenSendKeys = new Set();
  let skippedNonMatchingPlacement = 0;
  let skippedMissingToEmail = 0;
  let skippedDuplicate = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of stagePlacements) {
    const placement = await hydrateJobOrderOwner({
      bullhorn,
      session,
      placement: item.placement,
      ownerCache,
    });
    if (!matchesPlacement(placement, { businessDateKey })) {
      skippedNonMatchingPlacement += 1;
      continue;
    }

    const sendKey = `${item.stage.key}:${placement.id}`;
    if (seenSendKeys.has(sendKey)) {
      skippedDuplicate += 1;
      continue;
    }
    seenSendKeys.add(sendKey);

    const transmissionPayload = buildTransmission({ placement, stage: item.stage });
    if (transmissionPayload.recipientEnvelope.missingToEmail) {
      skippedMissingToEmail += 1;
      continue;
    }

    const entityId = `${item.stage.key}|${placement.id}|${item.queryDate}`;
    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement",
        entityId,
        metadata: {
          stageKey: item.stage.key,
          queryDate: item.queryDate,
          businessDate: businessDateKey,
          placementId: placement.id,
        },
      });
      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        continue;
      }
      if (sendLock.skipped) sendLockUnavailable += 1;
    }

    const record = buildReportRecord({
      placement,
      stage: item.stage,
      businessDateKey,
      queryDate: item.queryDate,
      transmission: transmissionPayload,
    });
    matchedPlacements.push({ ...record, sendLock });
    sparkPostPayload.push(record.sparkPostPayload);

    if (!config.DRY_RUN) {
      try {
        const transmission = await sparkPost.sendInlineTransmission({
          ...transmissionPayload,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "reminder",
            ruleKey: item.stage.key,
            recipientType: "jobOrderOwner",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            placementId: placement?.id || null,
            candidateId: placement?.candidate?.id || null,
            clientCorporationId: placement?.clientCorporation?.id || null,
            ownerId: placement?.jobOrder?.owner?.id || null,
            ownerEmail: placement?.jobOrder?.owner?.email || "",
            businessDate: businessDateKey,
            runDate: businessDateKey,
            context: { queryDate: item.queryDate },
            metadata: { stageKey: item.stage.key, dayOffset: item.stage.dayOffset },
          },
        });
        transmissions.push({ placementId: placement.id, stage: item.stage.key, transmission });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "placement",
            entityId,
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
    queryPlan,
    totals: {
      totalPlacementsQueried: stagePlacements.length,
      matchedPlacements: matchedPlacements.length,
      skippedNonMatchingPlacement,
      skippedMissingToEmail,
      skippedDuplicate,
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

  return buildWorkflowResult({
    workflowName: WORKFLOW_NAME,
    report,
    artifacts: { reportPath, sparkPostPayloadReportPath },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Placement end date reminder sync failed");
    process.exitCode = 1;
  });
}

module.exports = { PLACEMENT_FIELDS, run };
