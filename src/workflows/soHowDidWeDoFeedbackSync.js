require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  reserveWorkflowSend,
  releaseWorkflowSend,
} = require("../stores/workflowSendLockStore");
const {
  listWorkflowSurveyTrackingDueForReminder,
  upsertWorkflowSurveyTracking,
} = require("../stores/workflowSurveyTrackingStore");
const {
  RULES,
  SKIPPED_PREVIEW_LIMIT,
  WORKFLOW_NAME,
  buildInitialTransmission,
  buildReminderDueDates,
  buildReminderTransmission,
  buildReportItem,
  buildRuleExecutionPlan,
  buildTrackingRecord,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
} = require("../utils/soHowDidWeDoFeedbackUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "dateEnd",
  "employmentType",
  "owner(id,firstName,lastName,email,pager)",
  "candidate(id,firstName,lastName,email,address(countryName),owner(id,firstName,lastName,email,primaryDepartment(name)))",
  "clientContact(id,firstName,lastName,email)",
  "billingClientContact(id,firstName,lastName,email)",
  "clientCorporation(id,name,address(countryName))",
  "jobOrder(id,title,address(countryName))",
].join(",");

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "so-how-did-we-do-feedback-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "so-how-did-we-do-feedback-sparkpost-payload",
    payload,
  });
}

function validateConfig(config) {
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
    throw new Error(`Missing required feedback workflow config: ${missing.join(", ")}`);
  }
}

async function queryPlacementsForRule({ bullhorn, session, rule, queryDate, count }) {
  const window = buildUtcDayWindowFromDateKey(queryDate);
  if (rule.source === "dateEnd") {
    return bullhorn.queryPlacementsByDateEndRange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      startMs: window.startMs,
      endMs: window.endMs,
      count,
      fieldsOverride: PLACEMENT_FIELDS,
    });
  }

  return bullhorn.queryPlacementsByDateBeginRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: window.startMs,
    endMs: window.endMs,
    count,
    fieldsOverride: PLACEMENT_FIELDS,
  });
}

async function sendReminderIfNeeded({ config, sparkPost, entity }) {
  const sendLock = config.DRY_RUN
    ? { skipped: true, reserved: true, reason: "dry-run" }
    : await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "survey-reminder",
        entityId: entity.surveyKey,
        metadata: {
          placementId: entity.placementId || null,
          surveyKey: entity.surveyKey,
          reminderDueDate: entity.reminderDueDate || null,
        },
      });

  if (!sendLock.reserved) {
    return {
      skipped: true,
      reason: "already-reminded",
      sendLock,
    };
  }

  const transmissionPayload = buildReminderTransmission({ entity });
  if (transmissionPayload.recipientEnvelope.missingToEmail) {
    return {
      skipped: true,
      reason: "missing-to-email",
      sendLock,
      transmissionPayload,
    };
  }

  if (!config.DRY_RUN) {
    try {
      await sparkPost.sendInlineTransmission(transmissionPayload);
      await upsertWorkflowSurveyTracking({
        config,
        tracking: {
          partitionKey: entity.partitionKey,
          rowKey: entity.rowKey,
          workflowName: WORKFLOW_NAME,
          surveyKey: entity.surveyKey,
          ruleKey: entity.ruleKey,
          recipientType: entity.recipientType,
          recipientEmail: entity.recipientEmail,
          recipientFirstName: entity.recipientFirstName,
          candidateId: entity.candidateId ?? null,
          candidateName: entity.candidateName || "",
          clientContactId: entity.clientContactId ?? null,
          clientContactName: entity.clientContactName || "",
          placementId: entity.placementId ?? null,
          clientCorporationId: entity.clientCorporationId ?? null,
          clientCorporationName: entity.clientCorporationName || "",
          employmentType: entity.employmentType || "",
          currentPlacementStatus: entity.currentPlacementStatus || "",
          businessDate: entity.businessDate || entity.initialSentDate || "",
          initialSentAt: entity.initialSentAt || "",
          initialSentDate: entity.initialSentDate || "",
          reminderDueDate: entity.reminderDueDate || "",
          reminderSentAt: new Date().toISOString(),
          respondedAt: entity.respondedAt || "",
          responseAnswer: entity.responseAnswer || "",
          trackingStatus: entity.respondedAt ? "responded" : "reminder-sent",
          tokenIssuedAt: entity.tokenIssuedAt || "",
          context: JSON.parse(entity.contextJson || "{}"),
          metadata: JSON.parse(entity.metadataJson || "{}"),
          runDate: entity.initialSentDate || entity.businessDate || "",
        },
      });
    } catch (error) {
      if (!sendLock.skipped) {
        await releaseWorkflowSend({
          config,
          workflowName: WORKFLOW_NAME,
          entityType: "survey-reminder",
          entityId: entity.surveyKey,
        }).catch(() => {});
      }
      throw error;
    }
  }

  return {
    skipped: false,
    sendLock,
    transmissionPayload,
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig("so-how-did-we-do-feedback-sync");
  validateConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.SO_HOW_DID_WE_DO_TARGET_DATE || business.dateKey;
  const queryCount = config.SO_HOW_DID_WE_DO_QUERY_COUNT || 200;

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      ruleCount: RULES.length,
      queryCount,
    },
    "Starting SO How Did We Do feedback sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const rulePlans = [];
  const querySummaries = [];
  const skippedItems = [];
  const sentItems = [];
  const sparkPostPayload = [];
  let initialMatches = 0;
  let remindersMatched = 0;
  let skippedMissingToEmail = 0;
  let skippedAlreadySent = 0;

  for (const rule of RULES) {
    const rulePlan = buildRuleExecutionPlan({
      rule,
      businessDateKey,
    });
    rulePlans.push(rulePlan);

    if (!rulePlan.queryDate) {
      continue;
    }

    const placements = await queryPlacementsForRule({
      bullhorn,
      session,
      rule,
      queryDate: rulePlan.queryDate,
      count: queryCount,
    });

    querySummaries.push({
      ruleKey: rule.key,
      source: rule.source,
      queryDate: rulePlan.queryDate,
      placementCount: placements.length,
    });

    for (const placement of placements) {
      const matchDetails = getMatchDetails(placement, rule);
      if (!matchDetails.matched) {
        if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
          skippedItems.push(
            buildReportItem({
              placement,
              rule,
              businessDateKey,
              queryDate: rulePlan.queryDate,
              sendType: "initial",
              reason: "placement-not-eligible",
              matchDetails,
            }),
          );
        }
        continue;
      }

      initialMatches += 1;
      const transmissionPayload = buildInitialTransmission({
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
              queryDate: rulePlan.queryDate,
              sendType: "initial",
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
              queryDate: rulePlan.queryDate,
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
              queryDate: rulePlan.queryDate,
              sendType: "initial",
              reason: "already-sent",
              matchDetails,
              recipientEnvelope: transmissionPayload.recipientEnvelope,
              sparkPostPayload: transmissionPayload,
            }),
          );
        }
        continue;
      }

      const trackingRecord = buildTrackingRecord({
        placement,
        rule,
        businessDateKey,
        transmissionPayload,
      });

      sentItems.push(
        buildReportItem({
          placement,
          rule,
          businessDateKey,
          queryDate: rulePlan.queryDate,
          sendType: "initial",
          recipientEnvelope: transmissionPayload.recipientEnvelope,
          sparkPostPayload: transmissionPayload,
          trackingRecord,
        }),
      );
      sparkPostPayload.push(transmissionPayload);

      if (!config.DRY_RUN) {
        try {
          await sparkPost.sendInlineTransmission(transmissionPayload);
          await upsertWorkflowSurveyTracking({
            config,
            tracking: trackingRecord,
          });
        } catch (error) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "survey-initial",
            entityId: transmissionPayload.tracking.surveyKey,
          }).catch(() => {});
          throw error;
        }
      }
    }
  }

  const reminderDueDates = buildReminderDueDates({ businessDateKey });
  const reminderQuerySummaries = [];

  for (const dueDate of reminderDueDates) {
    const entities = await listWorkflowSurveyTrackingDueForReminder({
      config,
      workflowName: WORKFLOW_NAME,
      dueDate,
    });
    reminderQuerySummaries.push({
      dueDate,
      trackingCount: entities.length,
    });

    for (const entity of entities) {
      remindersMatched += 1;
      const reminderResult = await sendReminderIfNeeded({
        config,
        sparkPost,
        entity,
      });

      if (reminderResult.skipped) {
        if (reminderResult.reason === "missing-to-email") {
          skippedMissingToEmail += 1;
        } else if (reminderResult.reason === "already-reminded") {
          skippedAlreadySent += 1;
        }

        if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
          skippedItems.push({
            placementId: entity.placementId ?? null,
            businessDate: businessDateKey,
            queryDate: dueDate,
            sendType: "reminder",
            ruleKey: entity.ruleKey || null,
            reason: reminderResult.reason,
            tracking: {
              surveyKey: entity.surveyKey,
              reminderDueDate: entity.reminderDueDate || null,
              respondedAt: entity.respondedAt || null,
              responseAnswer: entity.responseAnswer || null,
              trackingStatus: entity.trackingStatus || null,
            },
            recipient: reminderResult.transmissionPayload?.recipientEnvelope || {
              toEmail: entity.recipientEmail || null,
              missingToEmail: true,
            },
          });
        }
        continue;
      }

      sentItems.push({
        placementId: entity.placementId ?? null,
        businessDate: businessDateKey,
        queryDate: dueDate,
        sendType: "reminder",
        ruleKey: entity.ruleKey || null,
        tracking: {
          surveyKey: entity.surveyKey,
          reminderDueDate: entity.reminderDueDate || null,
          reminderSentAt: config.DRY_RUN ? null : new Date().toISOString(),
          respondedAt: entity.respondedAt || null,
          responseAnswer: entity.responseAnswer || null,
          trackingStatus: entity.respondedAt ? "responded" : "reminder-sent",
        },
        recipient: reminderResult.transmissionPayload.recipientEnvelope,
        sparkPostPayload: reminderResult.transmissionPayload,
      });
      sparkPostPayload.push(reminderResult.transmissionPayload);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    businessDate: businessDateKey,
    rulePlans,
    querySummaries,
    reminderQuerySummaries,
    totals: {
      initialMatches,
      remindersMatched,
      matchedPlacements: sentItems.length,
      sentCount: sentItems.length,
      skippedMissingToEmail,
      skippedAlreadySent,
      skippedPreviewCount: skippedItems.length,
    },
    skippedItems,
    placements: sentItems,
    sparkPost: {
      sent: !config.DRY_RUN && sentItems.length > 0,
      payloadCount: sparkPostPayload.length,
      payload: sparkPostPayload,
    },
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
    logger.error(serializeError(error), "SO How Did We Do feedback sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  WORKFLOW_NAME,
  run,
};
