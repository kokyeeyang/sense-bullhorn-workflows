require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const { SparkPostClient } = require("./sparkPostClient");
const {
  buildPlacementTerminationRecipient,
  isTerminatedPlacementStatusChange,
} = require("./placementTerminationEmailUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("./workflowRuntime");

function getTemplateId(config) {
  return config.PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID || config.SPARKPOST_TEMPLATE_ID || null;
}

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY");
  if (!getTemplateId(config)) {
    missing.push("PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID or SPARKPOST_TEMPLATE_ID");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "placement-termination-email-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "placement-termination-email-sparkpost-payload",
    payload,
  });
}

async function run() {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const templateId = getTemplateId(config);

  logger.info(
    {
      dryRun: config.DRY_RUN,
      placementTerminationEventSubscriptionId: config.PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID,
      placementTerminationEventMaxEvents: config.PLACEMENT_TERMINATION_EVENT_MAX_EVENTS,
      sparkPostTemplateId: templateId,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting placement termination email sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  await bullhorn.upsertEventSubscription({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID,
    entityName: "Placement",
  });

  const eventResponse = await bullhorn.consumeEvents({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID,
    maxEvents: config.PLACEMENT_TERMINATION_EVENT_MAX_EVENTS,
  });

  const events = eventResponse.events || [];
  logger.info({ eventCount: events.length }, "Fetched placement termination events");

  let skippedNoStatusChange = 0;
  let skippedWrongTransition = 0;
  let skippedMissingOwnerEmail = 0;
  let skippedDuplicatePlacement = 0;
  const candidateCache = new Map();
  const ownerCache = new Map();
  const processedPlacementIds = new Set();
  const matchedPlacements = [];
  const sparkPostRecipients = [];

  for (const event of events) {
    const updatedProperties = event.updatedProperties || [];
    if (!updatedProperties.includes("status")) {
      skippedNoStatusChange += 1;
      continue;
    }

    const placementId = Number(event.entityId || 0);
    const transactionId = event.entityEvent?.transactionID || event.transactionID || null;
    if (!placementId || !transactionId) {
      skippedWrongTransition += 1;
      continue;
    }

    const statusChange = await bullhorn.getPlacementStatusChange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      transactionId,
    });

    if (!isTerminatedPlacementStatusChange(statusChange)) {
      skippedWrongTransition += 1;
      continue;
    }

    if (processedPlacementIds.has(placementId)) {
      skippedDuplicatePlacement += 1;
      continue;
    }

    const placement = await bullhorn.getPlacement({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      placementId,
    });

    const candidateId = placement?.candidate?.id || null;
    if (!candidateId) {
      skippedMissingOwnerEmail += 1;
      continue;
    }

    let candidate = candidateCache.get(candidateId);
    if (!candidate) {
      candidate = await bullhorn.getCandidate({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        candidateId,
      });
      candidateCache.set(candidateId, candidate);
    }

    const ownerId = candidate?.owner?.id || null;
    if (!ownerId) {
      skippedMissingOwnerEmail += 1;
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
      continue;
    }

    const hydratedPlacement = {
      ...placement,
      candidate: {
        ...placement?.candidate,
        firstName: placement?.candidate?.firstName || candidate?.firstName || null,
        lastName: placement?.candidate?.lastName || candidate?.lastName || null,
        email: placement?.candidate?.email || candidate?.email || null,
      },
    };

    const sparkPostRecipient = buildPlacementTerminationRecipient({
      placement: hydratedPlacement,
      owner,
      recipientEmail: owner.email,
    });

    processedPlacementIds.add(placementId);
    sparkPostRecipients.push(sparkPostRecipient);
    matchedPlacements.push({
      placementId,
      transactionId,
      statusChange,
      owner: {
        id: owner.id,
        firstName: owner.firstName || null,
        lastName: owner.lastName || null,
        email: owner.email,
      },
      placement: {
        id: hydratedPlacement.id,
        status: hydratedPlacement.status || null,
        dateBegin: hydratedPlacement.dateBegin || null,
        dateEnd: hydratedPlacement.dateEnd || null,
        candidate: hydratedPlacement.candidate || null,
        clientCorporation: hydratedPlacement.clientCorporation || null,
        jobOrder: hydratedPlacement.jobOrder || null,
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
    });
  }

  logger.info(
    {
      totalEvents: events.length,
      matchedPlacements: matchedPlacements.length,
      recipientCount: sparkPostRecipients.length,
      skippedNoStatusChange,
      skippedWrongTransition,
      skippedMissingOwnerEmail,
      skippedDuplicatePlacement,
      sparkPostSent: !config.DRY_RUN && sparkPostRecipients.length > 0,
    },
    "Placement termination email sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    subscriptionId: config.PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID,
    totals: {
      totalEvents: events.length,
      matchedPlacements: matchedPlacements.length,
      recipients: sparkPostRecipients.length,
      skippedNoStatusChange,
      skippedWrongTransition,
      skippedMissingOwnerEmail,
      skippedDuplicatePlacement,
    },
    sparkPost: {
      templateId,
      recipientCount: sparkPostRecipients.length,
      sent: !config.DRY_RUN && sparkPostRecipients.length > 0,
      transmission,
      payload: sparkPostPayload,
    },
    recipients: sparkPostRecipients,
    placements: matchedPlacements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({
    payload: sparkPostPayload,
  });
  logger.info({ reportPath }, "Placement termination email report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "Placement termination email SparkPost payload report written",
  );

  return buildWorkflowResult({
    workflowName: "placement-termination-email-sync",
    report,
    artifacts: {
      reportPath,
      sparkPostPayloadReportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Placement termination email sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  getTemplateId,
  run,
  writeSparkPostPayloadReport,
};
