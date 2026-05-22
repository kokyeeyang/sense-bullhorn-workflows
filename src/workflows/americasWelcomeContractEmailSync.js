require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");
const {
  QUERY_COUNT_DEFAULT,
  WORKFLOW_NAME,
  buildAttachment,
  buildCurrentActionTypeChange,
  buildImmediateChangeDateKeys,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  findAttachmentPath,
  getBusinessDateParts,
  getMatchDetails,
} = require("../utils/americasWelcomeContractEmailUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const CANDIDATE_FIELDS = [
  "id",
  "firstName",
  "lastName",
  "email",
  "dateAdded",
  "dateLastModified",
  "address(countryName)",
];

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) return;
  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
}

function getQueryCount(config) {
  return config.AMERICAS_WELCOME_CONTRACT_EMAIL_QUERY_COUNT || QUERY_COUNT_DEFAULT;
}

function getTransactionId(record) {
  return record?.transactionID || record?.transactionId || null;
}

function buildSkippedItem({
  candidate,
  queryDate,
  reason,
  change = null,
  transactionId = null,
  matchDetails = null,
  sendLock = null,
}) {
  return {
    candidateId: candidate?.id ?? null,
    queryDate,
    transactionId,
    reason,
    change: change ? { oldValue: change.oldValue ?? null, newValue: change.newValue ?? null } : null,
    matchDetails,
    sendLock,
    candidate: candidate || null,
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig("americas-welcome-contract-email-sync");
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.AMERICAS_WELCOME_CONTRACT_EMAIL_TARGET_DATE || business.dateKey;
  const queryDateKeys = buildImmediateChangeDateKeys({ businessDateKey, weekendAdjust: true });
  const actionTypeField = config.AMERICAS_WELCOME_CONTRACT_EMAIL_ACTION_TYPE_FIELD || "customText16";
  const candidateFields = Array.from(new Set([...CANDIDATE_FIELDS, actionTypeField])).join(",");

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      queryDateKeys,
      queryCount: getQueryCount(config),
      actionTypeField,
    },
    "Starting Americas welcome contract email sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const rawMatches = [];
  const skippedItems = [];

  for (const queryDate of queryDateKeys) {
    const window = buildUtcDayWindowFromDateKey(queryDate);
    const candidates = await bullhorn.queryCandidatesByDateLastModifiedRange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      startMs: window.startMs,
      endMs: window.endMs,
      count: getQueryCount(config),
      fieldsOverride: candidateFields,
    });

    for (const candidate of candidates) {
      const change = buildCurrentActionTypeChange(candidate, actionTypeField);
      const matchDetails = getMatchDetails(candidate, { change, actionTypeField });
      if (!matchDetails.matched) {
        skippedItems.push(buildSkippedItem({
          candidate,
          queryDate,
          transactionId,
          change,
          reason: "candidate-not-eligible",
          matchDetails,
        }));
        continue;
      }

      rawMatches.push({ candidate, queryDate, change, transactionId: null });
    }
  }

  const attachmentPath = findAttachmentPath();
  const attachmentResult = attachmentPath
    ? { attachmentPaths: [attachmentPath], attachments: [buildAttachment(attachmentPath)], missing: false }
    : { attachmentPaths: [], attachments: [], missing: true };
  const seen = new Set();
  const candidates = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedDuplicate = 0;
  let skippedMissingToEmail = 0;
  let skippedMissingAttachment = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of rawMatches) {
    const dedupeKey = `${item.candidate.id}:${item.change.newValue}`;
    if (seen.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(dedupeKey);

    if (attachmentResult.missing) {
      skippedMissingAttachment += 1;
      skippedItems.push(buildSkippedItem({
        candidate: item.candidate,
        queryDate: item.queryDate,
        transactionId: item.transactionId,
        change: item.change,
        reason: "missing-attachment",
      }));
      continue;
    }

    const transmissionPayload = buildTransmission({
      candidate: item.candidate,
      attachments: attachmentResult.attachments,
    });
    if (transmissionPayload.recipientEnvelope.missingToEmail) {
      skippedMissingToEmail += 1;
      skippedItems.push(buildSkippedItem({
        candidate: item.candidate,
        queryDate: item.queryDate,
        transactionId: item.transactionId,
        change: item.change,
        reason: "missing-to-email",
      }));
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    const entityId = `${item.candidate.id}:${actionTypeField}:${item.change.newValue}`;
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "candidate",
        entityId,
        metadata: {
          businessDate: businessDateKey,
          queryDate: item.queryDate,
          transactionId: item.transactionId || null,
          candidateId: item.candidate.id,
          actionTypeField,
          actionTypeValue: item.change.newValue,
        },
      });
      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        skippedItems.push(buildSkippedItem({
          candidate: item.candidate,
          queryDate: item.queryDate,
          transactionId: item.transactionId,
          change: item.change,
          reason: "already-sent",
          sendLock,
        }));
        continue;
      }
      if (sendLock.skipped) sendLockUnavailable += 1;
    }

    const reportRecord = {
      candidateId: item.candidate.id,
      businessDate: businessDateKey,
      queryDate: item.queryDate,
      transactionId: item.transactionId,
      change: { oldValue: item.change.oldValue ?? null, newValue: item.change.newValue ?? null },
      actionTypeField,
      sendLock,
      candidate: item.candidate,
      recipient: transmissionPayload.recipientEnvelope,
      attachmentPaths: attachmentResult.attachmentPaths,
      sparkPostPayload: transmissionPayload,
    };
    candidates.push(reportRecord);
    sparkPostPayload.push(transmissionPayload);

    if (!config.DRY_RUN) {
      try {
        const transmission = await sparkPost.sendInlineTransmission({
          ...transmissionPayload,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "notification",
            recipientType: "candidate",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            recipientFirstName: item.candidate?.firstName || "",
            candidateId: item.candidate.id,
            businessDate: businessDateKey,
            runDate: businessDateKey,
            context: {
              queryDate: item.queryDate,
              transactionId: item.transactionId || null,
              actionTypeField,
            },
            metadata: {
              attachmentPaths: attachmentResult.attachmentPaths,
            },
          },
        });
        transmissions.push({ candidateId: item.candidate.id, transmission });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "candidate",
            entityId,
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
    businessHour: business.hour,
    queryDateKeys,
    totals: {
      totalMatchesBeforeDedupe: rawMatches.length,
      matchedCandidates: candidates.length,
      skippedDuplicate,
      skippedMissingToEmail,
      skippedMissingAttachment,
      skippedAlreadySent,
      sendLockUnavailable,
      skippedPreviewCount: skippedItems.length,
    },
    sparkPost: {
      sent: !config.DRY_RUN && candidates.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    skippedItems,
    candidates,
  };

  const reportPath = await writeJsonArtifact({ filePrefix: "americas-welcome-contract-email-report", payload: report });
  const sparkPostPayloadReportPath = await writeJsonArtifact({
    filePrefix: "americas-welcome-contract-email-sparkpost-payload",
    payload: sparkPostPayload,
  });

  return buildWorkflowResult({
    workflowName: WORKFLOW_NAME,
    report,
    artifacts: { reportPath, sparkPostPayloadReportPath },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Americas welcome contract email sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  CANDIDATE_FIELDS,
  WORKFLOW_NAME,
  run,
};
