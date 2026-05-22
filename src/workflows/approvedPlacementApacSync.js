require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");
const {
  WORKFLOW_NAME,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isApprovedApacStatusChange,
  matchesPlacement,
} = require("../utils/approvedPlacementApacUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "employmentType",
  "owner(id,firstName,lastName,email,pager)",
  "candidate(id,firstName,lastName,name)",
  "clientCorporation(id,name)",
  "jobOrder(id,title,employmentType,clientCorporation(id,name),owner(id,firstName,lastName,email,pager))",
].join(",");

function findStatusChange(record) {
  const changes = Array.isArray(record?.fieldChanges)
    ? record.fieldChanges
    : Array.isArray(record?.fieldChanges?.data)
      ? record.fieldChanges.data
      : [];
  return changes.find((change) => String(change.columnName || change.fieldName || "").toLowerCase() === "status") || null;
}

async function run({ targetDate } = {}) {
  const config = loadConfig("approved-placement-apac-sync");
  if (!config.DRY_RUN && !config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }

  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.APPROVED_PLACEMENT_APAC_TARGET_DATE || business.dateKey;
  const window = buildUtcDayWindowFromDateKey(businessDateKey);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const records = await bullhorn.queryPlacementEditHistoryByDateAddedRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: window.startMs,
    endMs: window.endMs,
    count: config.APPROVED_PLACEMENT_APAC_QUERY_COUNT,
  });

  const matchedPlacements = [];
  const skippedRecords = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedMissingPlacementId = 0;
  let skippedStatusChangeMismatch = 0;
  let skippedRuleMismatch = 0;
  let skippedMissingOwnerEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const record of records) {
    const statusChange = findStatusChange(record);
    const placementId = record?.targetEntity?.id || null;
    if (!placementId) {
      skippedMissingPlacementId += 1;
      continue;
    }
    if (!isApprovedApacStatusChange(statusChange)) {
      skippedStatusChangeMismatch += 1;
      continue;
    }

    const placement = await bullhorn.getPlacementByIdWithFields({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      placementId,
      fields: PLACEMENT_FIELDS,
    });
    const matchDetails = getMatchDetails({ placement, statusChange });
    if (!matchesPlacement({ placement, statusChange })) {
      skippedRuleMismatch += 1;
      skippedRecords.push({ placementId, reason: "rule-filter-mismatch", statusChange, matchDetails });
      continue;
    }

    const transmissionPayload = buildTransmission({ placement });
    if (transmissionPayload.recipientEnvelope.missingOwnerEmail) {
      skippedMissingOwnerEmail += 1;
      skippedRecords.push({ placementId, reason: "missing-owner-email", statusChange, matchDetails });
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    const sendLockEntityId = `${placementId}:${record.transactionID || businessDateKey}`;
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement-status-change",
        entityId: sendLockEntityId,
        metadata: { businessDate: businessDateKey, transactionId: record.transactionID || null },
      });
      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        continue;
      }
      if (sendLock.skipped) sendLockUnavailable += 1;
    }

    matchedPlacements.push({
      placementId,
      transactionId: record.transactionID || null,
      statusChange,
      matchDetails,
      sendLock,
      placement,
      recipient: transmissionPayload.recipientEnvelope,
      sparkPostPayload: transmissionPayload,
    });
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
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail,
            placementId,
            businessDate: businessDateKey,
            runDate: businessDateKey,
            metadata: { transactionId: record.transactionID || null },
          },
        });
        transmissions.push({ placementId, transmission });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "placement-status-change",
            entityId: sendLockEntityId,
          }).catch(() => {});
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
      totalEditHistoryRecords: records.length,
      matchedPlacements: matchedPlacements.length,
      skippedMissingPlacementId,
      skippedStatusChangeMismatch,
      skippedRuleMismatch,
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
    skippedRecords,
  };
  const reportPath = await writeJsonArtifact({ filePrefix: "approved-placement-apac-report", payload: report });
  const sparkPostPayloadReportPath = await writeJsonArtifact({
    filePrefix: "approved-placement-apac-sparkpost-payload",
    payload: sparkPostPayload,
  });
  return buildWorkflowResult({ workflowName: WORKFLOW_NAME, report, artifacts: { reportPath, sparkPostPayloadReportPath } });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Approved placement APAC sync failed");
    process.exitCode = 1;
  });
}

module.exports = { PLACEMENT_FIELDS, findStatusChange, run };
