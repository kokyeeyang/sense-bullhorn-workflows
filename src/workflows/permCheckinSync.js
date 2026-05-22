require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  releaseWorkflowSend,
  reserveWorkflowSend,
} = require("../stores/workflowSendLockStore");
const { upsertWorkflowSurveyTracking } = require("../stores/workflowSurveyTrackingStore");
const {
  QUERY_COUNT_DEFAULT,
  RULES,
  SKIPPED_PREVIEW_LIMIT,
  WORKFLOW_NAME,
  buildReportItem,
  buildRuleExecutionPlan,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
} = require("../utils/permCheckinUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "employmentType",
  "owner(id,firstName,lastName,email,primaryDepartment(name))",
  "candidate(id,firstName,lastName,email,owner(id,firstName,lastName,email,primaryDepartment(name)))",
  "clientContact(id,firstName,lastName,email)",
  "billingClientContact(id,firstName,lastName,email)",
  "clientCorporation(id,name,address(countryName))",
  "jobOrder(id,title,employmentType,address(countryName),owner(id,firstName,lastName,email,primaryDepartment(name)))",
].join(",");

function validateConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) {
    missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
  if (!config.PERM_CHECKIN_RESPONSE_BASE_URL && !config.WORKFLOW_SURVEY_RESPONSE_BASE_URL) {
    missing.push("PERM_CHECKIN_RESPONSE_BASE_URL or WORKFLOW_SURVEY_RESPONSE_BASE_URL");
  }
  if (!config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET) {
    missing.push("WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required perm check-in workflow config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "perm-checkin-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "perm-checkin-sparkpost-payload",
    payload,
  });
}

async function run({ targetDate } = {}) {
  const config = loadConfig("perm-checkin-sync");
  validateConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.PERM_CHECKIN_TARGET_DATE || business.dateKey;
  const forceTimedRules = Boolean(targetDate || config.PERM_CHECKIN_TARGET_DATE);
  const queryCount = config.PERM_CHECKIN_QUERY_COUNT || QUERY_COUNT_DEFAULT;

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      queryCount,
      ruleCount: RULES.length,
    },
    "Starting perm check-in sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const rulePlans = [];
  const querySummaries = [];
  const skippedItems = [];
  const sentItems = [];
  const sparkPostPayload = [];
  const transmissions = [];
  const seenRulePlacementKeys = new Set();
  let skippedNonMatchingPlacement = 0;
  let skippedMissingToEmail = 0;
  let skippedAlreadySent = 0;

  for (const rule of RULES) {
    const rulePlan = buildRuleExecutionPlan({
      rule,
      businessDateKey,
      businessHour: business.hour,
      force: forceTimedRules,
    });
    rulePlans.push(rulePlan);

    for (const queryDateBegin of rulePlan.queryDateBeginDates) {
      const window = buildUtcDayWindowFromDateKey(queryDateBegin);
      const placements = await bullhorn.queryPlacementsByDateBeginRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: queryCount,
        fieldsOverride: PLACEMENT_FIELDS,
      });

      querySummaries.push({
        ruleKey: rule.key,
        queryDateBegin,
        placementCount: placements.length,
      });

      for (const placement of placements) {
        const dedupeKey = `${rule.key}:${placement.id}`;
        if (seenRulePlacementKeys.has(dedupeKey)) {
          continue;
        }
        seenRulePlacementKeys.add(dedupeKey);

        const matchDetails = getMatchDetails(placement, rule);
        if (!matchDetails.matched) {
          skippedNonMatchingPlacement += 1;
          if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
            skippedItems.push(
              buildReportItem({
                placement,
                rule,
                businessDateKey,
                queryDateBegin,
                reason: "placement-not-eligible",
                matchDetails,
              }),
            );
          }
          continue;
        }

        const transmissionPayload = buildTransmission({
          placement,
          rule,
          config,
          businessDateKey,
        });

        if (transmissionPayload.recipientEnvelope.missingToEmail) {
          skippedMissingToEmail += 1;
          if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
            skippedItems.push(
              buildReportItem({
                placement,
                rule,
                businessDateKey,
                queryDateBegin,
                reason: "missing-to-email",
                matchDetails,
                recipientEnvelope: transmissionPayload.recipientEnvelope,
                sparkPostPayload: transmissionPayload,
              }),
            );
          }
          continue;
        }

        const sendLock = config.DRY_RUN
          ? { skipped: true, reserved: true, reason: "dry-run" }
          : await reserveWorkflowSend({
              config,
              workflowName: WORKFLOW_NAME,
              entityType: "survey-initial",
              entityId: transmissionPayload.tracking.surveyKey,
              metadata: {
                placementId: placement.id,
                ruleKey: rule.key,
                queryDateBegin,
              },
            });

        if (!sendLock.reserved) {
          skippedAlreadySent += 1;
          if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
            skippedItems.push(
              buildReportItem({
                placement,
                rule,
                businessDateKey,
                queryDateBegin,
                reason: "already-sent",
                matchDetails,
                recipientEnvelope: transmissionPayload.recipientEnvelope,
                sparkPostPayload: transmissionPayload,
                sendLock,
              }),
            );
          }
          continue;
        }

        sentItems.push(
          buildReportItem({
            placement,
            rule,
            businessDateKey,
            queryDateBegin,
            matchDetails,
            recipientEnvelope: transmissionPayload.recipientEnvelope,
            sparkPostPayload: transmissionPayload,
            sendLock,
          }),
        );
        sparkPostPayload.push(transmissionPayload);

        if (!config.DRY_RUN) {
          try {
            const transmission = await sparkPost.sendInlineTransmission(transmissionPayload);
            transmissions.push({
              placementId: placement.id,
              ruleKey: rule.key,
              transmission,
            });
            await upsertWorkflowSurveyTracking({
              config,
              tracking: transmissionPayload.tracking,
            });
          } catch (error) {
            if (!sendLock.skipped) {
              await releaseWorkflowSend({
                config,
                workflowName: WORKFLOW_NAME,
                entityType: "survey-initial",
                entityId: transmissionPayload.tracking.surveyKey,
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
    rulePlans,
    querySummaries,
    totals: {
      totalPlacementsQueried: querySummaries.reduce((sum, item) => sum + item.placementCount, 0),
      matchedPlacements: sentItems.length,
      sentCount: sentItems.length,
      skippedNonMatchingPlacement,
      skippedMissingToEmail,
      skippedAlreadySent,
      skippedPreviewCount: skippedItems.length,
    },
    sparkPost: {
      sent: !config.DRY_RUN && sentItems.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    skippedItems,
    placements: sentItems,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: sparkPostPayload });

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
    logger.error(serializeError(error), "Perm check-in sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  WORKFLOW_NAME,
  run,
};
