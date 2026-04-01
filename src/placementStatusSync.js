require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const {
  buildCandidatePatchFromPlacement,
  getFieldChanges,
  isTargetPlacementStatusChange,
} = require("./placementUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("./workflowRuntime");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "placement-status-report", payload: report });
}

async function run() {
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      placementEventSubscriptionId: config.PLACEMENT_EVENT_SUBSCRIPTION_ID,
      placementEventMaxEvents: config.PLACEMENT_EVENT_MAX_EVENTS,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
      updateDelayMs: config.UPDATE_DELAY_MS,
    },
    "Starting placement status sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  await bullhorn.upsertEventSubscription({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.PLACEMENT_EVENT_SUBSCRIPTION_ID,
    entityName: "Placement",
  });

  const eventResponse = await bullhorn.consumeEvents({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.PLACEMENT_EVENT_SUBSCRIPTION_ID,
    maxEvents: config.PLACEMENT_EVENT_MAX_EVENTS,
  });

  const events = eventResponse.events || [];
  logger.info({ eventCount: events.length }, "Fetched placement events");

  let updated = 0;
  let skippedNoStatusChange = 0;
  let skippedWrongTransition = 0;
  let skippedNoPatch = 0;
  let skippedNoChange = 0;
  const affectedCandidates = [];

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

    if (!isTargetPlacementStatusChange(statusChange)) {
      skippedWrongTransition += 1;
      continue;
    }

    const placement = await bullhorn.getPlacement({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      placementId,
    });

    const candidateUpdate = buildCandidatePatchFromPlacement(placement);
    if (!candidateUpdate) {
      skippedNoPatch += 1;
      continue;
    }

    const changes = getFieldChanges(placement.candidate, candidateUpdate.patch);
    if (changes.length === 0) {
      skippedNoChange += 1;
      continue;
    }

    if (config.DRY_RUN) {
      affectedCandidates.push({
        placementId,
        candidateId: candidateUpdate.candidateId,
        mode: "dry-run",
        mappingType: "placement-status-transition",
        transactionId,
        changes,
      });

      logger.info(
        {
          placementId,
          candidateId: candidateUpdate.candidateId,
          transactionId,
          statusChange,
          changes,
          patch: candidateUpdate.patch,
        },
        "DRY_RUN: candidate would be updated from placement status transition",
      );

      updated += 1;
      continue;
    }

    await bullhorn.updateCandidate({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      candidateId: candidateUpdate.candidateId,
      patch: candidateUpdate.patch,
    });

    affectedCandidates.push({
      placementId,
      candidateId: candidateUpdate.candidateId,
      mode: "updated",
      mappingType: "placement-status-transition",
      transactionId,
      changes,
    });

    updated += 1;
    logger.info(
      {
        placementId,
        candidateId: candidateUpdate.candidateId,
        transactionId,
        statusChange,
        changes,
      },
      "Candidate updated from placement status transition",
    );

    if (config.UPDATE_DELAY_MS > 0) {
      await sleep(config.UPDATE_DELAY_MS);
    }
  }

  logger.info(
    {
      updated,
      skippedNoStatusChange,
      skippedWrongTransition,
      skippedNoPatch,
      skippedNoChange,
      totalEvents: events.length,
    },
    "Placement status sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    subscriptionId: config.PLACEMENT_EVENT_SUBSCRIPTION_ID,
    totals: {
      totalEvents: events.length,
      affectedCandidates: affectedCandidates.length,
      updated,
      skippedNoStatusChange,
      skippedWrongTransition,
      skippedNoPatch,
      skippedNoChange,
    },
    affectedCandidates,
  };

  const reportPath = await writeChangesReport({ report });
  logger.info({ reportPath }, "Placement changes report written");

  return buildWorkflowResult({
    workflowName: "placement-status-sync",
    report,
    artifacts: {
      reportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Placement status sync failed");
    process.exitCode = 1;
  });
}

module.exports = { run };
