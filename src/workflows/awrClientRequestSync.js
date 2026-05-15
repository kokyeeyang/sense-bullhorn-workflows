require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");
const {
  INITIAL_OFFSET_DAYS,
  REMINDER_OFFSET_DAYS,
  WORKFLOW_NAME,
  buildDateBeginQueryDates,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
  matchesPlacement,
} = require("../utils/awrClientRequestUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "employmentType",
  "vendorType",
  "customText8",
  "customText10",
  "address(countryName)",
  "candidate(id,firstName,lastName,name)",
  "clientContact(id,firstName,lastName,email)",
  "billingClientContact(id,firstName,lastName,email,address(countryName))",
  "clientCorporation(id,name,address(countryName))",
  "jobOrder(id,title,employmentType,address(countryName))",
].join(",");

async function run({ targetDate } = {}) {
  const config = loadConfig();
  if (!config.DRY_RUN && !config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.AWR_CLIENT_REQUEST_TARGET_DATE || business.dateKey;
  const force = Boolean(targetDate || config.AWR_CLIENT_REQUEST_TARGET_DATE);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });

  if (!isTimedRuleDue({ businessHour: business.hour, dayOfWeek: business.dayOfWeek, force })) {
    const report = {
      generatedAt: new Date().toISOString(),
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      skippedReason: business.dayOfWeek === 0 || business.dayOfWeek === 6 ? "outside-pacific-weekday" : "outside-send-hour",
      totals: { totalPlacementsQueried: 0, matchedPlacements: 0 },
      sparkPost: { sent: false, transmissionCount: 0, payloadCount: 0, transmissions: [], payload: [] },
      placements: [],
      skippedPlacements: [],
    };
    const reportPath = await writeJsonArtifact({ filePrefix: "awr-client-request-report", payload: report });
    const sparkPostPayloadReportPath = await writeJsonArtifact({ filePrefix: "awr-client-request-sparkpost-payload", payload: [] });
    return buildWorkflowResult({ workflowName: WORKFLOW_NAME, report, artifacts: { reportPath, sparkPostPayloadReportPath } });
  }

  const stages = [
    { sendType: "initial", offsetDays: INITIAL_OFFSET_DAYS },
    { sendType: "reminder", offsetDays: REMINDER_OFFSET_DAYS },
  ];
  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const queriedItems = [];
  const seen = new Set();

  for (const stage of stages) {
    const dateBeginDates = force ? [businessDateKey] : buildDateBeginQueryDates({ businessDateKey, offsetDays: stage.offsetDays });
    for (const queryDateBegin of dateBeginDates) {
      const window = buildUtcDayWindowFromDateKey(queryDateBegin);
      const placements = await bullhorn.queryPlacementsByDateBeginRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: config.AWR_CLIENT_REQUEST_QUERY_COUNT,
        fieldsOverride: PLACEMENT_FIELDS,
      });
      for (const placement of placements) {
        const key = `${stage.sendType}:${placement.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queriedItems.push({ stage, queryDateBegin, placement });
      }
    }
  }

  const matchedPlacements = [];
  const skippedPlacements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedRuleMismatch = 0;
  let skippedMissingClientContactEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of queriedItems) {
    const matchDetails = getMatchDetails(item.placement);
    if (!matchesPlacement(item.placement)) {
      skippedRuleMismatch += 1;
      skippedPlacements.push({ placementId: item.placement.id, sendType: item.stage.sendType, reason: "rule-filter-mismatch", matchDetails });
      continue;
    }
    const transmissionPayload = buildTransmission({ placement: item.placement, sendType: item.stage.sendType });
    if (transmissionPayload.recipientEnvelope.missingClientContactEmail) {
      skippedMissingClientContactEmail += 1;
      skippedPlacements.push({ placementId: item.placement.id, sendType: item.stage.sendType, reason: "missing-client-contact-email", matchDetails });
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    const entityId = `${item.stage.sendType}:${item.placement.id}`;
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement-stage",
        entityId,
        metadata: { businessDate: businessDateKey, queryDateBegin: item.queryDateBegin, sendType: item.stage.sendType },
      });
      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        continue;
      }
      if (sendLock.skipped) sendLockUnavailable += 1;
    }

    matchedPlacements.push({
      placementId: item.placement.id,
      sendType: item.stage.sendType,
      queryDateBegin: item.queryDateBegin,
      matchDetails,
      recipient: transmissionPayload.recipientEnvelope,
      attachmentPaths: transmissionPayload.attachmentPaths,
      sendLock,
      sparkPostPayload: transmissionPayload,
      placement: item.placement,
    });
    sparkPostPayload.push(transmissionPayload);

    if (!config.DRY_RUN) {
      try {
        const transmission = await sparkPost.sendInlineTransmission({
          content: transmissionPayload.content,
          recipients: transmissionPayload.recipients,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: item.stage.sendType,
            recipientType: "client-contact",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail,
            placementId: item.placement.id,
            businessDate: businessDateKey,
            runDate: businessDateKey,
          },
        });
        transmissions.push({ placementId: item.placement.id, sendType: item.stage.sendType, transmission });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({ config, workflowName: WORKFLOW_NAME, entityType: "placement-stage", entityId }).catch(() => {});
        }
        throw error;
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    businessDate: businessDateKey,
    totals: {
      totalPlacementsQueried: queriedItems.length,
      matchedPlacements: matchedPlacements.length,
      skippedRuleMismatch,
      skippedMissingClientContactEmail,
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
  const reportPath = await writeJsonArtifact({ filePrefix: "awr-client-request-report", payload: report });
  const sparkPostPayloadReportPath = await writeJsonArtifact({ filePrefix: "awr-client-request-sparkpost-payload", payload: sparkPostPayload });
  return buildWorkflowResult({ workflowName: WORKFLOW_NAME, report, artifacts: { reportPath, sparkPostPayloadReportPath } });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "AWR client request sync failed");
    process.exitCode = 1;
  });
}

module.exports = { PLACEMENT_FIELDS, run };
