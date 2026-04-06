require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const {
  buildCandidatePatchFromPlacementForDatabaseEnrichment,
  buildPreviousUtcDayWindow,
  getFieldChanges,
  getStatusChangeFromEditHistory,
  isTargetPlacementDatabaseEnrichmentStatusChange,
} = require("./placementDatabaseEnrichmentUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("./workflowRuntime");

const SKIPPED_TRANSITIONS_PREVIEW_LIMIT = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "placement-database-enrichment-report",
    payload: report,
  });
}

function buildAffectedCandidateRecord({ match, placement, candidateUpdate, changes, mode }) {
  return {
    placementId: match.placementId,
    candidateId: candidateUpdate.candidateId,
    mode,
    mappingType: "placement-database-enrichment",
    ruleType: candidateUpdate.ruleType,
    transactionId: match.transactionId,
    statusChange: match.statusChange,
    placement: {
      status: placement?.status ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      dateBegin: placement?.dateBegin ?? null,
      dateEnd: placement?.dateEnd ?? null,
      payRate: placement?.payRate ?? null,
      clientCorporationName: placement?.clientCorporation?.name ?? null,
      jobOrderTitle: placement?.jobOrder?.title ?? null,
    },
    candidate: {
      companyName: placement?.candidate?.companyName ?? null,
      occupation: placement?.candidate?.occupation ?? null,
      status: placement?.candidate?.status ?? null,
      dateAvailable: placement?.candidate?.dateAvailable ?? null,
      hourlyRateLow: placement?.candidate?.hourlyRateLow ?? null,
    },
    changes,
  };
}

async function run() {
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });
  const window = buildPreviousUtcDayWindow({
    daysBack: config.PLACEMENT_DATABASE_ENRICHMENT_DAYS_BACK,
  });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      daysBack: config.PLACEMENT_DATABASE_ENRICHMENT_DAYS_BACK,
      targetDate: window.targetDate,
      startMs: window.startMs,
      endMs: window.endMs,
      queryCount: config.PLACEMENT_DATABASE_ENRICHMENT_QUERY_COUNT,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
      updateDelayMs: config.UPDATE_DELAY_MS,
    },
    "Starting placement database enrichment sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const editHistories = await bullhorn.queryPlacementEditHistoryByDateAddedRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: window.startMs,
    endMs: window.endMs,
    count: config.PLACEMENT_DATABASE_ENRICHMENT_QUERY_COUNT,
  });

  logger.info(
    { editHistoryCount: editHistories.length },
    "Fetched placement edit histories for enrichment window",
  );

  let skippedMissingPlacementId = 0;
  let skippedWrongTransition = 0;
  let skippedDuplicatePlacement = 0;
  let skippedNoPatch = 0;
  let skippedNoChange = 0;
  let updated = 0;
  const matchedTransitionsByPlacementId = new Map();
  const affectedCandidates = [];
  const skippedTransitions = [];

  for (const editHistory of editHistories) {
    const placementId = Number(editHistory?.targetEntity?.id || 0);
    if (!placementId) {
      skippedMissingPlacementId += 1;
      continue;
    }

    const statusChange = getStatusChangeFromEditHistory(editHistory);
    if (!isTargetPlacementDatabaseEnrichmentStatusChange(statusChange)) {
      skippedWrongTransition += 1;
      if (skippedTransitions.length < SKIPPED_TRANSITIONS_PREVIEW_LIMIT) {
        skippedTransitions.push({
          placementId,
          editHistoryId: editHistory.id || null,
          transactionId: editHistory.transactionID || null,
          dateAdded: editHistory.dateAdded || null,
          oldValue: statusChange?.oldValue ?? null,
          newValue: statusChange?.newValue ?? null,
          reason: statusChange ? "status-transition-not-targeted" : "missing-status-change",
        });
      }
      continue;
    }

    if (matchedTransitionsByPlacementId.has(placementId)) {
      skippedDuplicatePlacement += 1;
    }

    matchedTransitionsByPlacementId.set(placementId, {
      placementId,
      editHistoryId: editHistory.id || null,
      transactionId: editHistory.transactionID || null,
      dateAdded: editHistory.dateAdded || null,
      statusChange,
    });
  }

  for (const match of matchedTransitionsByPlacementId.values()) {
    const placement = await bullhorn.getPlacement({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      placementId: match.placementId,
    });

    const candidateUpdate = buildCandidatePatchFromPlacementForDatabaseEnrichment(placement);
    if (!candidateUpdate) {
      skippedNoPatch += 1;
      continue;
    }

    const changes = getFieldChanges(placement?.candidate, candidateUpdate.patch);
    if (changes.length === 0) {
      skippedNoChange += 1;
      continue;
    }

    if (config.DRY_RUN) {
      affectedCandidates.push(
        buildAffectedCandidateRecord({
          match,
          placement,
          candidateUpdate,
          changes,
          mode: "dry-run",
        }),
      );

      logger.info(
        {
          placementId: match.placementId,
          candidateId: candidateUpdate.candidateId,
          transactionId: match.transactionId,
          statusChange: match.statusChange,
          ruleType: candidateUpdate.ruleType,
          changes,
          patch: candidateUpdate.patch,
        },
        "DRY_RUN: candidate would be updated from placement database enrichment",
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

    affectedCandidates.push(
      buildAffectedCandidateRecord({
        match,
        placement,
        candidateUpdate,
        changes,
        mode: "updated",
      }),
    );

    updated += 1;
    logger.info(
      {
        placementId: match.placementId,
        candidateId: candidateUpdate.candidateId,
        transactionId: match.transactionId,
        statusChange: match.statusChange,
        ruleType: candidateUpdate.ruleType,
        changes,
      },
      "Candidate updated from placement database enrichment",
    );

    if (config.UPDATE_DELAY_MS > 0) {
      await sleep(config.UPDATE_DELAY_MS);
    }
  }

  logger.info(
    {
      totalEditHistories: editHistories.length,
      matchedTransitions: matchedTransitionsByPlacementId.size,
      updated,
      skippedMissingPlacementId,
      skippedWrongTransition,
      skippedDuplicatePlacement,
      skippedNoPatch,
      skippedNoChange,
    },
    "Placement database enrichment sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    window: {
      daysBack: config.PLACEMENT_DATABASE_ENRICHMENT_DAYS_BACK,
      targetDate: window.targetDate,
      startMs: window.startMs,
      endMs: window.endMs,
    },
    totals: {
      totalEditHistories: editHistories.length,
      matchedTransitions: matchedTransitionsByPlacementId.size,
      affectedCandidates: affectedCandidates.length,
      updated,
      skippedMissingPlacementId,
      skippedWrongTransition,
      skippedDuplicatePlacement,
      skippedNoPatch,
      skippedNoChange,
    },
    skippedTransitions,
    affectedCandidates,
  };

  const reportPath = await writeChangesReport({ report });
  logger.info({ reportPath }, "Placement database enrichment report written");

  return buildWorkflowResult({
    workflowName: "placement-database-enrichment-sync",
    report,
    artifacts: {
      reportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Placement database enrichment sync failed");
    process.exitCode = 1;
  });
}

module.exports = { run };
