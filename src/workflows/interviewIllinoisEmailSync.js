require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  buildInterviewIllinoisRecipient,
  getIllinoisInterviewJobOrderMatchDetails,
  isInterviewAppointment,
} = require("../utils/interviewIllinoisEmailUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

function getTemplateId(config) {
  return config.INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID || config.SPARKPOST_TEMPLATE_ID || null;
}

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  if (!getTemplateId(config)) {
    missing.push("INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID or SPARKPOST_TEMPLATE_ID");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "interview-illinois-email-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "interview-illinois-email-sparkpost-payload",
    payload,
  });
}

function buildSkippedAppointmentPreview({ appointmentId, appointment = null, reason, matchDetails = null }) {
  return {
    appointmentId: appointmentId || null,
    reason,
    appointment: appointment
      ? {
          id: appointment.id ?? null,
          type: appointment.type || null,
          dateAdded: appointment.dateAdded || null,
          candidateReference: appointment.candidateReference || null,
          jobOrder: appointment.jobOrder || null,
        }
      : null,
    matchDetails,
  };
}

async function run() {
  const config = loadConfig("interview-illinois-email-sync");
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const templateId = getTemplateId(config);

  logger.info(
    {
      dryRun: config.DRY_RUN,
      interviewIllinoisEventSubscriptionId: config.INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID,
      interviewIllinoisEventMaxEvents: config.INTERVIEW_ILLINOIS_EVENT_MAX_EVENTS,
      interviewIllinoisJobOrderState: config.INTERVIEW_ILLINOIS_JOB_ORDER_STATE,
      interviewIllinoisJobOrderDateAdded: config.INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED,
      interviewIllinoisJobOrderEmploymentType:
        config.INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE,
      sparkPostTemplateId: templateId,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting interview Illinois email sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  await bullhorn.upsertEventSubscription({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID,
    entityName: "Appointment",
    eventType: "INSERTED",
  });

  const eventResponse = await bullhorn.consumeEvents({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID,
    maxEvents: config.INTERVIEW_ILLINOIS_EVENT_MAX_EVENTS,
  });

  const events = eventResponse.events || [];
  logger.info({ eventCount: events.length }, "Fetched interview Illinois events");

  let skippedNonInterview = 0;
  let skippedMissingAppointmentId = 0;
  let skippedJobOrderMismatch = 0;
  let skippedMissingOwnerId = 0;
  let skippedMissingOwnerEmail = 0;
  let skippedDuplicateAppointment = 0;
  const processedAppointmentIds = new Set();
  const ownerCache = new Map();
  const matchedAppointments = [];
  const skippedAppointments = [];
  const sparkPostRecipients = [];

  for (const event of events) {
    const appointmentId = Number(event.entityId || 0);
    if (!appointmentId) {
      skippedMissingAppointmentId += 1;
      continue;
    }

    if (processedAppointmentIds.has(appointmentId)) {
      skippedDuplicateAppointment += 1;
      continue;
    }

    const appointment = await bullhorn.getAppointment({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      appointmentId,
    });

    if (!isInterviewAppointment(appointment)) {
      skippedNonInterview += 1;
      skippedAppointments.push(
        buildSkippedAppointmentPreview({
          appointmentId,
          appointment,
          reason: "non-interview-appointment",
        }),
      );
      continue;
    }

    const jobOrderMatchDetails = getIllinoisInterviewJobOrderMatchDetails({ appointment, config });
    if (!jobOrderMatchDetails.matches) {
      skippedJobOrderMismatch += 1;
      skippedAppointments.push({
        appointmentId,
        candidateReference: appointment?.candidateReference || null,
        reason: "job-order-filter-mismatch",
        jobOrder: {
          id: appointment?.jobOrder?.id ?? null,
          owner: appointment?.jobOrder?.owner || null,
        },
        matchDetails: jobOrderMatchDetails,
      });
      continue;
    }

    const ownerId = appointment?.jobOrder?.owner?.id || null;
    if (!ownerId) {
      skippedMissingOwnerId += 1;
      skippedAppointments.push(
        buildSkippedAppointmentPreview({
          appointmentId,
          appointment,
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

    if (!owner?.email) {
      skippedMissingOwnerEmail += 1;
      skippedAppointments.push(
        buildSkippedAppointmentPreview({
          appointmentId,
          appointment,
          reason: "missing-job-order-owner-email",
        }),
      );
      continue;
    }

    const sparkPostRecipient = buildInterviewIllinoisRecipient({
      appointment,
      owner,
      recipientEmail: owner.email,
    });

    processedAppointmentIds.add(appointmentId);
    sparkPostRecipients.push(sparkPostRecipient);
    matchedAppointments.push({
      appointmentId,
      owner: {
        id: owner.id,
        firstName: owner.firstName || null,
        lastName: owner.lastName || null,
        email: owner.email,
      },
      appointment: {
        id: appointment.id,
        type: appointment.type || null,
        dateAdded: appointment.dateAdded || null,
        candidateReference: appointment.candidateReference || null,
        jobOrder: appointment.jobOrder || null,
      },
      sparkPostRecipient,
    });
  }

  let transmission = null;
  const sparkPostPayload = {
    content: {
      template_id: templateId,
    },
    recipients: sparkPostRecipients,
  };

  if (!config.DRY_RUN && sparkPostRecipients.length > 0) {
    transmission = await sparkPost.sendTransmission({
      templateId,
      recipients: sparkPostRecipients,
      audit: {
        workflowName: "interview-illinois-email-sync",
        sendType: "notification",
        recipientType: "job-owner",
        metadata: {
          subscriptionId: config.INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID,
          appointmentIds: matchedAppointments.map((item) => item.appointmentId),
          recipientCount: sparkPostRecipients.length,
        },
      },
    });
  }

  logger.info(
    {
      totalEvents: events.length,
      matchedAppointments: matchedAppointments.length,
      recipientCount: sparkPostRecipients.length,
      skippedNonInterview,
      skippedMissingAppointmentId,
      skippedJobOrderMismatch,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
      skippedDuplicateAppointment,
      sparkPostSent: !config.DRY_RUN && sparkPostRecipients.length > 0,
    },
    "Interview Illinois email sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    subscriptionId: config.INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID,
    filters: {
      jobOrderState: config.INTERVIEW_ILLINOIS_JOB_ORDER_STATE,
      jobOrderDateAdded: config.INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED,
      jobOrderEmploymentType: config.INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE,
    },
    totals: {
      totalEvents: events.length,
      matchedAppointments: matchedAppointments.length,
      recipients: sparkPostRecipients.length,
      skippedNonInterview,
      skippedMissingAppointmentId,
      skippedJobOrderMismatch,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
      skippedDuplicateAppointment,
    },
    skippedAppointments,
    sparkPost: {
      templateId,
      recipientCount: sparkPostRecipients.length,
      sent: !config.DRY_RUN && sparkPostRecipients.length > 0,
      transmission,
      payload: sparkPostPayload,
    },
    recipients: sparkPostRecipients,
    appointments: matchedAppointments,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({
    payload: sparkPostPayload,
  });
  logger.info({ reportPath }, "Interview Illinois email report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "Interview Illinois email SparkPost payload report written",
  );

  return buildWorkflowResult({
    workflowName: "interview-illinois-email-sync",
    report,
    artifacts: {
      reportPath,
      sparkPostPayloadReportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Interview Illinois email sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  buildSkippedAppointmentPreview,
  getTemplateId,
  run,
  writeSparkPostPayloadReport,
};
