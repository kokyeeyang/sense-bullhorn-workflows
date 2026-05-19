require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const {
  buildCandidateOwnerPatchFromPlacement,
  buildCandidatePatchFromPlacementForDatabaseEnrichment,
  buildClientCorporationPoPatchFromPlacement,
  getFieldChanges,
  getPlacementDatabaseEnrichmentMatchReason,
} = require("../utils/placementDatabaseEnrichmentUtils");
const { resolveEventSubscriptionId } = require("../utils/eventSubscriptionConfig");
const {
  writeComparisonRecordsSafe,
} = require("../stores/placementDatabaseEnrichmentComparisonStore");
const {
  writeWorkflowDataMutationAuditRecordsSafe,
} = require("../stores/postgresWorkflowDataMutationAuditStore");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const WORKFLOW_NAME = "placement-database-enrichment-sync";
const SKIPPED_TRANSITIONS_PREVIEW_LIMIT = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

const CANDIDATE_OWNER_PLACEMENT_FIELDS = [
  "id",
  "dateAdded",
  "employmentType",
  "candidate(id,firstName,lastName,email,owner(id,firstName,lastName,email))",
  "jobOrder(id,title,owner(id,firstName,lastName,email))",
  "clientCorporation(id,name)",
].join(",");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBullhornEntityNotFoundError(error) {
  return (
    error?.response?.status === 404 &&
    (error?.response?.data?.errorMessageKey === "errors.entityNotFound" ||
      error?.response?.data?.errorMessage === "Entity not found.")
  );
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

function buildPlacementFieldsWithClientCorporationPoField(config) {
  const poClientField = String(config.PLACEMENT_DATABASE_ENRICHMENT_PO_CLIENT_FIELD || "").trim();
  const clientCorporationFields = [
    "id",
    "name",
    "customText2",
    "customText10",
    "customText11",
    "customDate1",
    "billingFrequency",
  ];
  if (poClientField && !clientCorporationFields.includes(poClientField)) {
    clientCorporationFields.push(poClientField);
  }

  return [
    "id",
    "status",
    "dateLastModified",
    "payRate",
    "customText8",
    "customText18",
    "customText60",
    "dateBegin",
    "dateEnd",
    "employmentType",
    "candidate(id,firstName,lastName,email,companyName,occupation,status,dateAvailable,hourlyRateLow)",
    `clientCorporation(${clientCorporationFields.join(",")})`,
    "billingClientContact(id,firstName,lastName,customText3,address)",
    "jobOrder(id,title,employmentType,owner(id,firstName,lastName,email))",
  ].join(",");
}

function buildAffectedCandidateRecord({ match, placement, candidateUpdate, changes, mode }) {
  return {
    placementId: match.placementId,
    candidateId: candidateUpdate.candidateId,
    mode,
    mappingType: "placement-database-enrichment",
    matchReason: match.matchReason || null,
    ruleType: candidateUpdate.ruleType,
    transactionId: match.transactionId || null,
    statusChange: match.statusChange || null,
    placement: {
      status: placement?.status ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      dateAdded: placement?.dateAdded ?? null,
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
      ownerId: placement?.candidate?.owner?.id ?? null,
    },
    changes,
  };
}

function buildAffectedClientCorporationRecord({ match, placement, clientCorporationUpdate, mode }) {
  return {
    placementId: match.placementId,
    clientCorporationId: clientCorporationUpdate.clientCorporationId,
    mode,
    mappingType: "placement-database-enrichment",
    ruleType: clientCorporationUpdate.ruleType,
    transactionId: match.transactionId || null,
    statusChange: match.statusChange || null,
    changes: clientCorporationUpdate.changes,
    placement: {
      status: placement?.status ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      poRequired: placement?.customText8 || null,
    },
    clientCorporation: {
      id: placement?.clientCorporation?.id ?? null,
      name: placement?.clientCorporation?.name || null,
    },
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

function buildBusinessDateWindow(dateKey) {
  const normalized = String(dateKey || new Date().toISOString()).slice(0, 10);
  const startMs = new Date(`${normalized}T00:00:00.000Z`).getTime();
  return {
    dateKey: normalized,
    startMs,
    endMs: startMs + DAY_MS,
  };
}

async function applyCandidateUpdate({ bullhorn, session, config, match, placement, candidateUpdate, changes, mode }) {
  if (!config.DRY_RUN) {
    await bullhorn.updateCandidate({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      candidateId: candidateUpdate.candidateId,
      patch: candidateUpdate.patch,
    });
  }

  return buildAffectedCandidateRecord({
    match,
    placement,
    candidateUpdate,
    changes,
    mode,
  });
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });
  const eventSubscriptionId = resolveEventSubscriptionId({
    config,
    subscriptionIdKey: "PLACEMENT_DATABASE_ENRICHMENT_EVENT_SUBSCRIPTION_ID",
    dryRunSubscriptionIdKey: "PLACEMENT_DATABASE_ENRICHMENT_DRY_RUN_EVENT_SUBSCRIPTION_ID",
  });
  const poClientField = String(config.PLACEMENT_DATABASE_ENRICHMENT_PO_CLIENT_FIELD || "").trim();

  logger.info(
    {
      dryRun: config.DRY_RUN,
      placementDatabaseEnrichmentEventSubscriptionId: eventSubscriptionId,
      placementDatabaseEnrichmentLiveEventSubscriptionId:
        config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_SUBSCRIPTION_ID,
      placementDatabaseEnrichmentDryRunEventSubscriptionId:
        config.PLACEMENT_DATABASE_ENRICHMENT_DRY_RUN_EVENT_SUBSCRIPTION_ID || null,
      placementDatabaseEnrichmentEventMaxEvents:
        config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS,
      poClientField: poClientField || null,
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
    subscriptionId: eventSubscriptionId,
    entityName: "Placement",
  });

  const eventResponse = await bullhorn.consumeEvents({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: eventSubscriptionId,
    maxEvents: config.PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS,
  });

  const events = eventResponse.events || [];
  logger.info({ eventCount: events.length }, "Fetched placement events for database enrichment");

  let skippedMissingPlacementId = 0;
  let skippedPlacementNotFound = 0;
  let skippedNotEligible = 0;
  let skippedDuplicatePlacement = 0;
  let skippedNoPatch = 0;
  let skippedNoChange = 0;
  let skippedMissingTransactionId = 0;
  let skippedCandidateOwnerNoPatch = 0;
  let skippedCandidateOwnerNoChange = 0;
  let skippedClientCorporationPoFieldNotConfigured = 0;
  let skippedClientCorporationPoNoPatch = 0;
  let updated = 0;
  let updatedCandidateOwners = 0;
  let updatedClientCorporations = 0;
  const matchedPlacementsByPlacementId = new Map();
  const affectedCandidates = [];
  const affectedClientCorporations = [];
  const skippedPlacements = [];
  const placementFields = buildPlacementFieldsWithClientCorporationPoField(config);

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
    let placement;
    try {
      placement = await bullhorn.getPlacementByIdWithFields({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        placementId: match.placementId,
        fields: placementFields,
      });
    } catch (error) {
      if (!isBullhornEntityNotFoundError(error)) {
        throw error;
      }

      skippedPlacementNotFound += 1;
      if (skippedPlacements.length < SKIPPED_TRANSITIONS_PREVIEW_LIMIT) {
        skippedPlacements.push({
          placementId: match.placementId,
          transactionId: match.transactionId,
          updatedProperties: match.updatedProperties,
          reason: "placement-not-found",
        });
      }
      logger.warn(
        {
          placementId: match.placementId,
          transactionId: match.transactionId,
          responseStatus: error?.response?.status || null,
          responseData: error?.response?.data || null,
        },
        "Skipping placement database enrichment event because placement was not found",
      );
      continue;
    }

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
    } else {
      const candidateUpdate = buildCandidatePatchFromPlacementForDatabaseEnrichment(placement);
      if (!candidateUpdate) {
        skippedNoPatch += 1;
      } else {
        const changes = getFieldChanges(placement?.candidate, candidateUpdate.patch);
        if (changes.length === 0) {
          skippedNoChange += 1;
        } else {
          const record = await applyCandidateUpdate({
            bullhorn,
            session,
            config,
            match: { ...match, statusChange, matchReason },
            placement,
            candidateUpdate,
            changes,
            mode: config.DRY_RUN ? "dry-run" : "updated",
          });
          affectedCandidates.push(record);
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
            config.DRY_RUN
              ? "DRY_RUN: candidate would be updated from placement database enrichment"
              : "Candidate updated from placement database enrichment",
          );

          if (!config.DRY_RUN && config.UPDATE_DELAY_MS > 0) {
            await sleep(config.UPDATE_DELAY_MS);
          }
        }
      }
    }

    if (statusChange && String(statusChange.newValue || "").trim().toLowerCase() === "approved") {
      if (!poClientField) {
        skippedClientCorporationPoFieldNotConfigured += 1;
      } else {
        const clientCorporationUpdate = buildClientCorporationPoPatchFromPlacement(placement, {
          fieldName: poClientField,
        });
        if (!clientCorporationUpdate) {
          skippedClientCorporationPoNoPatch += 1;
        } else {
          if (!config.DRY_RUN) {
            await bullhorn.updateClientCorporation({
              restUrl: session.restUrl,
              bhRestToken: session.bhRestToken,
              clientCorporationId: clientCorporationUpdate.clientCorporationId,
              patch: clientCorporationUpdate.patch,
            });
          }
          affectedClientCorporations.push(
            buildAffectedClientCorporationRecord({
              match: { ...match, statusChange },
              placement,
              clientCorporationUpdate,
              mode: config.DRY_RUN ? "dry-run" : "updated",
            }),
          );
          updatedClientCorporations += 1;
          logger.info(
            {
              placementId: match.placementId,
              clientCorporationId: clientCorporationUpdate.clientCorporationId,
              fieldName: poClientField,
              changes: clientCorporationUpdate.changes,
            },
            config.DRY_RUN
              ? "DRY_RUN: client corporation PO flag would be updated"
              : "Client corporation PO flag updated from placement database enrichment",
          );
        }
      }
    }
  }

  const dateAddedBusinessDate =
    targetDate ||
    config.PLACEMENT_DATABASE_ENRICHMENT_DATE_ADDED_TARGET_DATE ||
    new Date().toISOString().slice(0, 10);
  const dateAddedWindow = buildBusinessDateWindow(dateAddedBusinessDate);
  const dateAddedPlacements = await bullhorn.queryPlacementsByDateAddedRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: dateAddedWindow.startMs,
    endMs: dateAddedWindow.endMs,
    count: config.PLACEMENT_DATABASE_ENRICHMENT_DATE_ADDED_QUERY_COUNT,
    fieldsOverride: CANDIDATE_OWNER_PLACEMENT_FIELDS,
  });

  for (const placement of dateAddedPlacements) {
    const candidateOwnerUpdate = buildCandidateOwnerPatchFromPlacement(placement, {
      minDateAdded: config.PLACEMENT_DATABASE_ENRICHMENT_CANDIDATE_OWNER_MIN_DATE_ADDED,
    });
    if (!candidateOwnerUpdate) {
      skippedCandidateOwnerNoPatch += 1;
      continue;
    }

    if (candidateOwnerUpdate.changes.length === 0) {
      skippedCandidateOwnerNoChange += 1;
      continue;
    }

    const record = await applyCandidateUpdate({
      bullhorn,
      session,
      config,
      match: {
        placementId: placement.id,
        transactionId: null,
        statusChange: null,
        matchReason: "candidate-owner-from-placement-date-added",
      },
      placement,
      candidateUpdate: candidateOwnerUpdate,
      changes: candidateOwnerUpdate.changes,
      mode: config.DRY_RUN ? "dry-run" : "updated",
    });
    affectedCandidates.push(record);
    updatedCandidateOwners += 1;
    logger.info(
      {
        placementId: placement.id,
        candidateId: candidateOwnerUpdate.candidateId,
        changes: candidateOwnerUpdate.changes,
      },
      config.DRY_RUN
        ? "DRY_RUN: candidate owner would be updated from placement job order owner"
        : "Candidate owner updated from placement job order owner",
    );
  }

  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    dryRun: config.DRY_RUN,
    subscriptionId: eventSubscriptionId,
    dateAddedWindow,
    poClientField: poClientField || null,
    totals: {
      totalEvents: events.length,
      matchedPlacements: matchedPlacementsByPlacementId.size,
      dateAddedPlacements: dateAddedPlacements.length,
      affectedCandidates: affectedCandidates.length,
      affectedClientCorporations: affectedClientCorporations.length,
      updated,
      updatedCandidateOwners,
      updatedClientCorporations,
      skippedMissingPlacementId,
      skippedPlacementNotFound,
      skippedMissingTransactionId,
      skippedNotEligible,
      skippedDuplicatePlacement,
      skippedNoPatch,
      skippedNoChange,
      skippedCandidateOwnerNoPatch,
      skippedCandidateOwnerNoChange,
      skippedClientCorporationPoFieldNotConfigured,
      skippedClientCorporationPoNoPatch,
    },
    skippedPlacements,
    affectedCandidates,
    affectedClientCorporations,
  };

  const comparisonReport = {
    generatedAt,
    dryRun: config.DRY_RUN,
    workflowName: WORKFLOW_NAME,
    comparisonRecords: [
      ...affectedCandidates.map((record) =>
        buildComparisonRecordFromAffectedCandidate({
          workflowName: WORKFLOW_NAME,
          generatedAt,
          record,
        }),
      ),
      ...skippedPlacements.map((record) =>
        buildComparisonRecordFromSkippedPlacement({
          workflowName: WORKFLOW_NAME,
          generatedAt,
          record,
        }),
      ),
    ],
  };

  report.dataMutationAudit = await writeWorkflowDataMutationAuditRecordsSafe({
    config,
    logger,
    workflowName: WORKFLOW_NAME,
    report,
  });

  const reportPath = await writeChangesReport({ report });
  const comparisonReportPath = await writeComparisonReport({ report: comparisonReport });
  await writeComparisonRecordsSafe({
    config,
    logger,
    records: comparisonReport.comparisonRecords,
  });
  logger.info(
    {
      reportPath,
      comparisonReportPath,
      totals: report.totals,
    },
    "Placement database enrichment sync finished",
  );

  return buildWorkflowResult({
    workflowName: WORKFLOW_NAME,
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
