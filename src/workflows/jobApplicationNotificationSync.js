require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  buildInlineEmailContent,
  buildJobApplicationRecipient,
  getJobApplicationNotificationMatchDetails,
} = require("../utils/jobApplicationNotificationUtils");
const { resolveEventSubscriptionId } = require("../utils/eventSubscriptionConfig");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "job-application-notification-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "job-application-notification-sparkpost-payload",
    payload,
  });
}

function buildSkippedSubmissionPreview({ jobSubmissionId, jobSubmission = null, reason, matchDetails = null }) {
  return {
    jobSubmissionId: jobSubmissionId || null,
    reason,
    jobSubmission: jobSubmission
      ? {
          id: jobSubmission.id ?? null,
          dateAdded: jobSubmission.dateAdded || null,
          source: jobSubmission.source || null,
          candidate: jobSubmission.candidate || null,
          jobOrder: jobSubmission.jobOrder || null,
        }
      : null,
    matchDetails,
  };
}

async function run() {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const eventSubscriptionId = resolveEventSubscriptionId({
    config,
    subscriptionIdKey: "JOB_APPLICATION_NOTIFICATION_EVENT_SUBSCRIPTION_ID",
    dryRunSubscriptionIdKey: "JOB_APPLICATION_NOTIFICATION_DRY_RUN_EVENT_SUBSCRIPTION_ID",
  });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      jobApplicationNotificationEventSubscriptionId: eventSubscriptionId,
      jobApplicationNotificationLiveEventSubscriptionId:
        config.JOB_APPLICATION_NOTIFICATION_EVENT_SUBSCRIPTION_ID,
      jobApplicationNotificationDryRunEventSubscriptionId:
        config.JOB_APPLICATION_NOTIFICATION_DRY_RUN_EVENT_SUBSCRIPTION_ID || null,
      jobApplicationNotificationEventMaxEvents:
        config.JOB_APPLICATION_NOTIFICATION_EVENT_MAX_EVENTS,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting job application notification sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  await bullhorn.upsertEventSubscription({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: eventSubscriptionId,
    entityName: "JobSubmission",
    eventType: "INSERTED",
  });

  const eventResponse = await bullhorn.consumeEvents({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: eventSubscriptionId,
    maxEvents: config.JOB_APPLICATION_NOTIFICATION_EVENT_MAX_EVENTS,
  });

  const events = eventResponse.events || [];
  logger.info({ eventCount: events.length }, "Fetched job application notification events");

  let skippedMissingSubmissionId = 0;
  let skippedDuplicateSubmission = 0;
  let skippedRuleMismatch = 0;
  let skippedMissingOwnerId = 0;
  let skippedMissingOwnerEmail = 0;
  const processedSubmissionIds = new Set();
  const ownerCache = new Map();
  const matchedSubmissions = [];
  const skippedSubmissions = [];
  const sparkPostPayloads = [];

  for (const event of events) {
    const jobSubmissionId = Number(event.entityId || 0);
    if (!jobSubmissionId) {
      skippedMissingSubmissionId += 1;
      continue;
    }

    if (processedSubmissionIds.has(jobSubmissionId)) {
      skippedDuplicateSubmission += 1;
      continue;
    }

    const jobSubmission = await bullhorn.getJobSubmission({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      jobSubmissionId,
    });

    const ownerId = jobSubmission?.jobOrder?.owner?.id || null;
    if (!ownerId) {
      skippedMissingOwnerId += 1;
      skippedSubmissions.push(
        buildSkippedSubmissionPreview({
          jobSubmissionId,
          jobSubmission,
          reason: "missing-job-order-owner-id",
        }),
      );
      continue;
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

    const matchDetails = getJobApplicationNotificationMatchDetails({
      jobSubmission,
      owner,
      config,
    });
    if (!matchDetails.matches) {
      skippedRuleMismatch += 1;
      skippedSubmissions.push(
        buildSkippedSubmissionPreview({
          jobSubmissionId,
          jobSubmission,
          reason: "rule-filter-mismatch",
          matchDetails,
        }),
      );
      continue;
    }

    if (!owner?.email) {
      skippedMissingOwnerEmail += 1;
      skippedSubmissions.push(
        buildSkippedSubmissionPreview({
          jobSubmissionId,
          jobSubmission,
          reason: "missing-job-order-owner-email",
          matchDetails,
        }),
      );
      continue;
    }

    const recipient = buildJobApplicationRecipient({
      recipientEmail: owner.email,
      jobSubmission,
      owner,
      matchedRule: matchDetails.matchedRule,
    });
    const content = buildInlineEmailContent({ jobSubmission, owner });
    const payload = {
      content,
      recipients: [recipient],
    };

    processedSubmissionIds.add(jobSubmissionId);
    sparkPostPayloads.push(payload);
    matchedSubmissions.push({
      jobSubmissionId,
      matchedRule: matchDetails.matchedRule,
      owner: {
        id: owner.id,
        firstName: owner.firstName || null,
        lastName: owner.lastName || null,
        email: owner.email,
        pager: owner.pager || null,
      },
      jobSubmission: {
        id: jobSubmission.id,
        dateAdded: jobSubmission.dateAdded || null,
        source: jobSubmission.source || null,
        candidate: jobSubmission.candidate || null,
        jobOrder: jobSubmission.jobOrder || null,
      },
      sparkPostRecipient: recipient,
      sparkPostContent: content,
    });
  }

  const transmissions = [];
  if (!config.DRY_RUN) {
    for (const payload of sparkPostPayloads) {
      const jobSubmissionId = payload.recipients[0]?.substitution_data?.job_submission_id || null;
      const transmission = await sparkPost.sendInlineTransmission({
        content: payload.content,
        recipients: payload.recipients,
        audit: {
          workflowName: "job-application-notification-sync",
          sendType: "notification",
          recipientType: "job-order-owner",
          metadata: {
            jobSubmissionId,
            matchedRule: payload.recipients[0]?.substitution_data?.matched_rule || null,
          },
        },
      });
      transmissions.push({ jobSubmissionId, transmission });
    }
  }

  logger.info(
    {
      totalEvents: events.length,
      matchedSubmissions: matchedSubmissions.length,
      recipientCount: sparkPostPayloads.length,
      skippedMissingSubmissionId,
      skippedDuplicateSubmission,
      skippedRuleMismatch,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
      sparkPostSent: !config.DRY_RUN && sparkPostPayloads.length > 0,
    },
    "Job application notification sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    subscriptionId: eventSubscriptionId,
    totals: {
      totalEvents: events.length,
      matchedSubmissions: matchedSubmissions.length,
      recipients: sparkPostPayloads.length,
      skippedMissingSubmissionId,
      skippedDuplicateSubmission,
      skippedRuleMismatch,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
    },
    sparkPost: {
      recipientCount: sparkPostPayloads.length,
      sent: !config.DRY_RUN && sparkPostPayloads.length > 0,
      transmissions,
      payloads: sparkPostPayloads,
    },
    skippedSubmissions,
    submissions: matchedSubmissions,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({
    payload: sparkPostPayloads,
  });
  logger.info({ reportPath }, "Job application notification report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "Job application notification SparkPost payload report written",
  );

  return buildWorkflowResult({
    workflowName: "job-application-notification-sync",
    report,
    artifacts: {
      reportPath,
      sparkPostPayloadReportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Job application notification sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  buildSkippedSubmissionPreview,
  run,
  writeSparkPostPayloadReport,
};
