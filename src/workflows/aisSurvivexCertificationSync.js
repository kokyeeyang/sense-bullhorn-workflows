require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");
const {
  EXPIRATION_OFFSET_DAYS,
  QUERY_COUNT_DEFAULT,
  WORKFLOW_NAME,
  addDays,
  buildAttachment,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  findAttachmentPath,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
} = require("../utils/aisSurvivexCertificationUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const CERTIFICATION_FIELDS = [
  "id",
  "dateExpiration",
  "candidate(id,firstName,lastName,email,dateAdded,dateLastPlacementStarted,owner(id,firstName,lastName,email))",
].join(",");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) return;
  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
}

function getQueryCount(config) {
  return config.AIS_SURVIVEX_CERTIFICATION_QUERY_COUNT || QUERY_COUNT_DEFAULT;
}

function buildSkippedItem({ certification, reason, matchDetails = null, sendLock = null }) {
  return {
    certificationId: certification?.id ?? null,
    candidateId: certification?.candidate?.id ?? null,
    reason,
    matchDetails,
    sendLock,
    certification: {
      id: certification?.id ?? null,
      dateExpiration: certification?.dateExpiration ?? null,
      candidate: certification?.candidate || null,
    },
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig("ais-survivex-certification-sync");
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.AIS_SURVIVEX_CERTIFICATION_TARGET_DATE || business.dateKey;
  const forceTimedRules = Boolean(targetDate || config.AIS_SURVIVEX_CERTIFICATION_TARGET_DATE);
  const expirationDateKey = addDays(businessDateKey, EXPIRATION_OFFSET_DAYS);
  const timedRuleDue = isTimedRuleDue({ businessHour: business.hour, force: forceTimedRules });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      expirationDate: expirationDateKey,
      timedRuleDue,
      queryCount: getQueryCount(config),
    },
    "Starting AIS Survivex certification sync",
  );

  const skippedItems = [];
  const certifications = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedMissingToEmail = 0;
  let skippedMissingAttachment = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  if (timedRuleDue) {
    const attachmentPath = findAttachmentPath();
    const attachmentResult = attachmentPath
      ? { attachmentPaths: [attachmentPath], attachments: [buildAttachment(attachmentPath)], missing: false }
      : { attachmentPaths: [], attachments: [], missing: true };

    if (attachmentResult.missing) {
      skippedMissingAttachment = 1;
    } else {
      const code = await bullhorn.getAuthorizationCode();
      const accessToken = await bullhorn.getAccessToken(code);
      const session = await bullhorn.login(accessToken);
      const window = buildUtcDayWindowFromDateKey(expirationDateKey);
      const rawCertifications = await bullhorn.queryCandidateCertificationsByExpirationRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: getQueryCount(config),
        entityName: config.AIS_SURVIVEX_CERTIFICATION_ENTITY_NAME || "CandidateCertification",
        fieldsOverride: CERTIFICATION_FIELDS,
      });

      for (const certification of rawCertifications) {
        const matchDetails = getMatchDetails(certification, { businessDateKey });
        if (!matchDetails.matched) {
          skippedItems.push(buildSkippedItem({
            certification,
            reason: "certification-not-eligible",
            matchDetails,
          }));
          continue;
        }

        const transmissionPayload = buildTransmission({
          certification,
          attachments: attachmentResult.attachments,
        });
        if (transmissionPayload.recipientEnvelope.missingToEmail) {
          skippedMissingToEmail += 1;
          skippedItems.push(buildSkippedItem({ certification, reason: "missing-to-email", matchDetails }));
          continue;
        }

        let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
        const entityId = `${certification.id || certification.candidate?.id}:${expirationDateKey}`;
        if (!config.DRY_RUN) {
          sendLock = await reserveWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "candidate-certification",
            entityId,
            metadata: {
              businessDate: businessDateKey,
              expirationDate: expirationDateKey,
              candidateId: certification?.candidate?.id || null,
            },
          });
          if (!sendLock.reserved) {
            skippedAlreadySent += 1;
            skippedItems.push(buildSkippedItem({ certification, reason: "already-sent", matchDetails, sendLock }));
            continue;
          }
          if (sendLock.skipped) sendLockUnavailable += 1;
        }

        const reportRecord = {
          certificationId: certification?.id ?? null,
          candidateId: certification?.candidate?.id ?? null,
          businessDate: businessDateKey,
          expirationDate: expirationDateKey,
          sendLock,
          certification,
          recipient: transmissionPayload.recipientEnvelope,
          attachmentPaths: attachmentResult.attachmentPaths,
          sparkPostPayload: transmissionPayload,
        };
        certifications.push(reportRecord);
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
                recipientFirstName: certification?.candidate?.firstName || "",
                candidateId: certification?.candidate?.id || null,
                businessDate: businessDateKey,
                runDate: businessDateKey,
                context: {
                  certificationId: certification?.id || null,
                  expirationDate: expirationDateKey,
                },
                metadata: {
                  attachmentPaths: attachmentResult.attachmentPaths,
                },
              },
            });
            transmissions.push({ certificationId: certification.id, candidateId: certification?.candidate?.id || null, transmission });
          } catch (error) {
            if (!sendLock.skipped) {
              await releaseWorkflowSend({
                config,
                workflowName: WORKFLOW_NAME,
                entityType: "candidate-certification",
                entityId,
              }).catch(() => {});
            }
            throw error;
          }
        }
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    businessDate: businessDateKey,
    businessHour: business.hour,
    expirationDate: expirationDateKey,
    timedRuleDue,
    totals: {
      matchedCertifications: certifications.length,
      skippedMissingToEmail,
      skippedMissingAttachment,
      skippedAlreadySent,
      sendLockUnavailable,
      skippedPreviewCount: skippedItems.length,
    },
    sparkPost: {
      sent: !config.DRY_RUN && certifications.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    skippedItems,
    certifications,
  };

  const reportPath = await writeJsonArtifact({ filePrefix: "ais-survivex-certification-report", payload: report });
  const sparkPostPayloadReportPath = await writeJsonArtifact({
    filePrefix: "ais-survivex-certification-sparkpost-payload",
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
    logger.error(serializeError(error), "AIS Survivex certification sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  CERTIFICATION_FIELDS,
  WORKFLOW_NAME,
  run,
};
