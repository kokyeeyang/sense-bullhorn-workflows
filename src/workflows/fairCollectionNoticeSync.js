require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");
const {
  QUERY_COUNT_DEFAULT,
  WORKFLOW_NAME,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
} = require("../utils/fairCollectionNoticeUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const CANDIDATE_FIELDS = [
  "id",
  "firstName",
  "lastName",
  "email",
  "dateAdded",
].join(",");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) return;
  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
}

function getQueryCount(config) {
  return config.FAIR_COLLECTION_NOTICE_QUERY_COUNT || QUERY_COUNT_DEFAULT;
}

function buildSkippedItem({ candidate, queryDate, reason, matchDetails = null, sendLock = null }) {
  return {
    candidateId: candidate?.id ?? null,
    queryDate,
    reason,
    matchDetails,
    sendLock,
    candidate: candidate || null,
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.FAIR_COLLECTION_NOTICE_TARGET_DATE || business.dateKey;
  const forceTimedRules = Boolean(targetDate || config.FAIR_COLLECTION_NOTICE_TARGET_DATE);
  const timedRuleDue = isTimedRuleDue({ businessHour: business.hour, force: forceTimedRules });
  const queryDateKeys = timedRuleDue ? [businessDateKey] : [];

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      timedRuleDue,
      queryDateKeys,
      queryCount: getQueryCount(config),
    },
    "Starting fair collection notice sync",
  );

  const rawMatches = [];
  const skippedItems = [];
  const querySummaries = [];

  if (timedRuleDue) {
    const code = await bullhorn.getAuthorizationCode();
    const accessToken = await bullhorn.getAccessToken(code);
    const session = await bullhorn.login(accessToken);

    for (const queryDate of queryDateKeys) {
      const window = buildUtcDayWindowFromDateKey(queryDate);
      const candidates = await bullhorn.searchCandidatesByDateAddedRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: getQueryCount(config),
        fieldsOverride: CANDIDATE_FIELDS,
      });
      querySummaries.push({
        queryDate,
        candidateCount: candidates.length,
      });

      for (const candidate of candidates) {
        const matchDetails = getMatchDetails(candidate);
        if (!matchDetails.matched) {
          skippedItems.push(buildSkippedItem({
            candidate,
            queryDate,
            reason: "candidate-not-eligible",
            matchDetails,
          }));
          continue;
        }

        rawMatches.push({ candidate, queryDate, matchDetails });
      }
    }
  }

  const seen = new Set();
  const candidates = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedDuplicate = 0;
  let skippedMissingToEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of rawMatches) {
    const dedupeKey = `${item.candidate.id}:${item.queryDate}`;
    if (seen.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(dedupeKey);

    const transmissionPayload = buildTransmission({ candidate: item.candidate });
    if (transmissionPayload.recipientEnvelope.missingToEmail) {
      skippedMissingToEmail += 1;
      skippedItems.push(buildSkippedItem({
        candidate: item.candidate,
        queryDate: item.queryDate,
        reason: "missing-to-email",
        matchDetails: item.matchDetails,
      }));
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    const entityId = `${item.candidate.id}:${item.queryDate}`;
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "candidate",
        entityId,
        metadata: {
          businessDate: businessDateKey,
          queryDate: item.queryDate,
          candidateId: item.candidate.id,
        },
      });
      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        skippedItems.push(buildSkippedItem({
          candidate: item.candidate,
          queryDate: item.queryDate,
          reason: "already-sent",
          matchDetails: item.matchDetails,
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
      sendLock,
      candidate: item.candidate,
      recipient: transmissionPayload.recipientEnvelope,
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
    timedRuleDue,
    queryDateKeys,
    querySummaries,
    totals: {
      totalMatchesBeforeDedupe: rawMatches.length,
      matchedCandidates: candidates.length,
      skippedDuplicate,
      skippedMissingToEmail,
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

  const reportPath = await writeJsonArtifact({ filePrefix: "fair-collection-notice-report", payload: report });
  const sparkPostPayloadReportPath = await writeJsonArtifact({
    filePrefix: "fair-collection-notice-sparkpost-payload",
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
    logger.error(serializeError(error), "Fair collection notice sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  CANDIDATE_FIELDS,
  WORKFLOW_NAME,
  run,
};
