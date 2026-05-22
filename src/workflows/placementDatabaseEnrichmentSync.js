require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const {
  buildCandidatePatchFromPlacementForDatabaseEnrichment,
  getFieldChanges,
  getPlacementDatabaseEnrichmentMatchReason,
} = require("../utils/placementDatabaseEnrichmentUtils");
const {
  writeComparisonRecordsSafe,
} = require("../stores/placementDatabaseEnrichmentComparisonStore");
const {
  writeWorkflowDataMutationAuditRecordsSafe,
} = require("../stores/postgresWorkflowDataMutationAuditStore");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

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

async function writeComparisonReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "placement-database-enrichment-comparison-report",
    payload: report,
  });
}

function buildAffectedCandidateRecord({ match, placement, candidateUpdate, changes, mode }) {
  return {
    placementId: match.placementId,
    candidateId: candidateUpdate.candidateId,
    mode,
    mappingType: "placement-database-enrichment",
    matchReason: match.matchReason || null,
    ruleType: candidateUpdate.ruleType,
    transactionId: match.transactionId,
    statusChange: match.statusChange,
    placement: {
      status: placement?.status ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      dateBegin: placement?.dateBegin ?? null,
      dateEnd: placement?.dateEnd ?? null,
      dateLastModified: placement?.dateLastModified ?? null,
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

function buildComparisonRecordFromAffectedCandidate({ workflowName, generatedAt, record }) {
  return {
    sourceSystem: "azure-functions",
    workflowName,
    recordType: "affected-candidate",
    actionDecision: record.mode === "dry-run" ? "would-update" : "updated",
    generatedAt,
    placementId: record.placementId,
    transactionId: record.transactionId || null,
    candidateId: record.candidateId || null,
    employmentType: record.placement?.employmentType || null,
    currentPlacementStatus: record.placement?.status || null,
    statusOldValue: record.statusChange?.oldValue ?? null,
    statusNewValue: record.statusChange?.newValue ?? null,
    dateLastModified: record.placement?.dateLastModified || null,
    matchReason: record.matchReason || null,
    ruleType: record.ruleType || null,
    fieldsToChange: Array.isArray(record.changes)
      ? record.changes.map((change) => change.field)
      : [],
  };
}

function buildComparisonRecordFromSkippedPlacement({ workflowName, generatedAt, record }) {
  return {
    sourceSystem: "azure-functions",
    workflowName,
    recordType: "skipped-placement",
    actionDecision: record.reason || "skipped",
    generatedAt,
    placementId: record.placementId,
    transactionId: record.transactionId || null,
    candidateId: null,
    employmentType: record.employmentType || null,
    currentPlacementStatus: null,
    statusOldValue: record.oldValue ?? null,
    statusNewValue: record.newValue ?? null,
    dateLastModified: record.dateLastModified || null,
    matchReason: null,
    ruleType: null,
    fieldsToChange: [],
    updatedProperties: record.updatedProperties || [],
  };
}

async function run() {
  const config = loadConfig("placement-database-enrichment-sync");
  const bullhorn = new BullhornClient({ config, logger });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      placementDatabaseEnrichmentEventSubscriptionId:
        config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_SUBSCRIPTION_ID,
      placementDatabaseEnrichmentEventMaxEvents:
        config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
      updateDelayMs: config.UPDATE_DELAY_MS,
    },
    "Starting placement database enrichment sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  await bullhorn.upsertEventSubscription({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_SUBSCRIPTION_ID,
    entityName: "Placement",
  });

  const eventResponse = await bullhorn.consumeEvents({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_SUBSCRIPTION_ID,
    maxEvents: config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS,
  });

  const events = eventResponse.events || [];
  logger.info({ eventCount: events.length }, "Fetched placement events for database enrichment");

  let skippedMissingPlacementId = 0;
  let skippedNotEligible = 0;
  let skippedDuplicatePlacement = 0;
  let skippedNoPatch = 0;
  let skippedNoChange = 0;
  let updated = 0;
  let skippedMissingTransactionId = 0;
  const matchedPlacementsByPlacementId = new Map();
  const affectedCandidates = [];
  const skippedPlacements = [];

  for (const event of events) {
    const placementId = Number(event.entityId || 0);
    if (!placementId) {
      skippedMissingPlacementId += 1;
      continue;
    }

    if (matchedPlacementsByPlacementId.has(placementId)) {
      skippedDuplicatePlacement += 1;
      continue;
    }

    matchedPlacementsByPlacementId.set(placementId, {
      placementId,
      transactionId: event.entityEvent?.transactionID || event.transactionID || null,
      updatedProperties: event.updatedProperties || [],
    });
  }

  for (const match of matchedPlacementsByPlacementId.values()) {
    const placement = await bullhorn.getPlacement({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      placementId: match.placementId,
    });

    let statusChange = null;
    if (match.updatedProperties.includes("status")) {
      if (!match.transactionId) {
        skippedMissingTransactionId += 1;
        if (skippedPlacements.length < SKIPPED_TRANSITIONS_PREVIEW_LIMIT) {
          skippedPlacements.push({
            placementId: match.placementId,
            transactionId: null,
            updatedProperties: match.updatedProperties,
            reason: "missing-transaction-id-for-status-change",
          });
        }
        continue;
      }

      statusChange = await bullhorn.getPlacementStatusChange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        transactionId: match.transactionId,
      });
    }

    const matchReason = getPlacementDatabaseEnrichmentMatchReason(placement, statusChange, {
      baseDate: new Date(),
    });
    if (!matchReason) {
      skippedNotEligible += 1;
      if (skippedPlacements.length < SKIPPED_TRANSITIONS_PREVIEW_LIMIT) {
        skippedPlacements.push({
          placementId: match.placementId,
          transactionId: match.transactionId,
          updatedProperties: match.updatedProperties,
          dateLastModified: placement?.dateLastModified ?? null,
          employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
          oldValue: statusChange?.oldValue ?? null,
          newValue: statusChange?.newValue ?? null,
          reason: "placement-not-eligible-for-database-enrichment",
        });
      }
      continue;
    }

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
          match: {
            ...match,
            statusChange,
            matchReason,
          },
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
          statusChange,
          matchReason,
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
        match: {
          ...match,
          statusChange,
          matchReason,
        },
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
        statusChange,
        matchReason,
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
      totalEvents: events.length,
      matchedPlacements: matchedPlacementsByPlacementId.size,
      updated,
      skippedMissingPlacementId,
      skippedMissingTransactionId,
      skippedNotEligible,
      skippedDuplicatePlacement,
      skippedNoPatch,
      skippedNoChange,
    },
    "Placement database enrichment sync finished",
  );

  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    dryRun: config.DRY_RUN,
    subscriptionId: config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_SUBSCRIPTION_ID,
    totals: {
      totalEvents: events.length,
      matchedPlacements: matchedPlacementsByPlacementId.size,
      affectedCandidates: affectedCandidates.length,
      updated,
      skippedMissingPlacementId,
      skippedMissingTransactionId,
      skippedNotEligible,
      skippedDuplicatePlacement,
      skippedNoPatch,
      skippedNoChange,
    },
    skippedPlacements,
    affectedCandidates,
  };
  const comparisonReport = {
    generatedAt,
    dryRun: config.DRY_RUN,
    workflowName: "placement-database-enrichment-sync",
    comparisonRecords: [
      ...affectedCandidates.map((record) =>
        buildComparisonRecordFromAffectedCandidate({
          workflowName: "placement-database-enrichment-sync",
          generatedAt,
          record,
        }),
      ),
      ...skippedPlacements.map((record) =>
        buildComparisonRecordFromSkippedPlacement({
          workflowName: "placement-database-enrichment-sync",
          generatedAt,
          record,
        }),
      ),
    ],
  };

  report.dataMutationAudit = await writeWorkflowDataMutationAuditRecordsSafe({
    config,
    logger,
    workflowName: "placement-database-enrichment-sync",
    report,
  });

  const reportPath = await writeChangesReport({ report });
  const comparisonReportPath = await writeComparisonReport({ report: comparisonReport });
  await writeComparisonRecordsSafe({
    config,
    logger,
    records: comparisonReport.comparisonRecords,
  });
  logger.info({ reportPath }, "Placement database enrichment report written");
  logger.info({ comparisonReportPath }, "Placement database enrichment comparison report written");

  return buildWorkflowResult({
    workflowName: "placement-database-enrichment-sync",
    report,
    artifacts: {
      reportPath,
      comparisonReportPath,
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
