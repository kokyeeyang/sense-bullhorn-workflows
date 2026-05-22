require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");
const {
  QUERY_COUNT_DEFAULT,
  RULES,
  SKIPPED_PREVIEW_LIMIT,
  WORKFLOW_NAME,
  buildPlacementReportRecord,
  buildRuleExecutionPlan,
  buildSkippedPlacementPreview,
  buildInlineTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  getPrimaryOwner,
} = require("../utils/americasInternalPlacementNoticesUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "employmentType",
  "owner(id,firstName,lastName,email,pager,reportToPerson(id,firstName,lastName,email))",
  "candidate(id,firstName,lastName,email,owner(id,firstName,lastName,email,pager,reportToPerson(id,firstName,lastName,email)))",
  "clientCorporation(id,name)",
  "jobOrder(id,title,employmentType,address(state,countryName),owner(id,firstName,lastName,email,pager,reportToPerson(id,firstName,lastName,email)))",
].join(",");

function extractFieldChanges(fieldChanges) {
  if (Array.isArray(fieldChanges)) {
    return fieldChanges;
  }
  if (Array.isArray(fieldChanges?.data)) {
    return fieldChanges.data;
  }
  return [];
}

function findStatusChange(record) {
  return extractFieldChanges(record?.fieldChanges).find(
    (change) => (change.columnName || change.fieldName) === "status",
  ) || null;
}

function getTransactionId(record) {
  return record?.transactionID || record?.transactionId || null;
}

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "americas-internal-placement-notices-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "americas-internal-placement-notices-sparkpost-payload",
    payload,
  });
}

async function hydratePlacementOwners({ bullhorn, session, placement, ownerCache }) {
  const ownerIds = [
    placement?.owner?.id,
    placement?.candidate?.owner?.id,
    placement?.jobOrder?.owner?.id,
  ].filter(Boolean);

  const owners = {};
  for (const ownerId of ownerIds) {
    if (!ownerCache.has(ownerId)) {
      ownerCache.set(
        ownerId,
        await bullhorn.getCorporateUser({
          restUrl: session.restUrl,
          bhRestToken: session.bhRestToken,
          corporateUserId: ownerId,
        }),
      );
    }
    owners[ownerId] = ownerCache.get(ownerId);
  }

  return {
    ...placement,
    owner: placement?.owner?.id ? { ...placement.owner, ...owners[placement.owner.id] } : placement?.owner,
    candidate: {
      ...placement?.candidate,
      owner: placement?.candidate?.owner?.id
        ? { ...placement.candidate.owner, ...owners[placement.candidate.owner.id] }
        : placement?.candidate?.owner,
    },
    jobOrder: {
      ...placement?.jobOrder,
      owner: placement?.jobOrder?.owner?.id
        ? { ...placement.jobOrder.owner, ...owners[placement.jobOrder.owner.id] }
        : placement?.jobOrder?.owner,
    },
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig("americas-internal-placement-notices-sync");
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey =
    targetDate || config.AMERICAS_INTERNAL_PLACEMENT_NOTICES_TARGET_DATE || business.dateKey;
  const forceTimedRules = Boolean(targetDate || config.AMERICAS_INTERNAL_PLACEMENT_NOTICES_TARGET_DATE);
  const queryCount = config.AMERICAS_INTERNAL_PLACEMENT_NOTICES_QUERY_COUNT || QUERY_COUNT_DEFAULT;

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      ruleCount: RULES.length,
      queryCount,
    },
    "Starting Americas internal placement notices sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const rawMatches = [];
  const skippedPlacements = [];
  const rulePlans = [];
  const querySummaries = [];
  const placementCache = new Map();

  for (const rule of RULES) {
    const rulePlan = buildRuleExecutionPlan({
      rule,
      businessDateKey,
      businessHour: business.hour,
      force: forceTimedRules,
    });
    rulePlans.push(rulePlan);

    if (!rulePlan.timedRuleDue) {
      continue;
    }

    if (rule.source === "dateBegin") {
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
          source: rule.source,
          queryDateBegin,
          placementCount: placements.length,
        });

        for (const placement of placements) {
          const matchDetails = getMatchDetails(placement, rule);
          if (!matchDetails.matched) {
            if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
              skippedPlacements.push(
                buildSkippedPlacementPreview({
                  placement,
                  rule,
                  queryDateBegin,
                  reason: "placement-not-eligible",
                  matchDetails,
                }),
              );
            }
            continue;
          }

          rawMatches.push({ placement, rule, queryDateBegin, change: null, transactionId: null });
        }
      }
      continue;
    }

    for (const queryDateBegin of rulePlan.queryStatusChangeDates) {
      const window = buildUtcDayWindowFromDateKey(queryDateBegin);
      const records = await bullhorn.queryPlacementEditHistoryByDateAddedRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: queryCount,
      });

      querySummaries.push({
        ruleKey: rule.key,
        source: rule.source,
        queryDateBegin,
        placementCount: records.length,
      });

      for (const record of records) {
        const change = findStatusChange(record);
        const placementId = Number(record?.targetEntity?.id || 0);
        const transactionId = getTransactionId(record);

        if (!change || !placementId) {
          continue;
        }

        let placement = placementCache.get(placementId);
        if (!placement) {
          placement = await bullhorn.getPlacementByIdWithFields({
            restUrl: session.restUrl,
            bhRestToken: session.bhRestToken,
            placementId,
            fields: PLACEMENT_FIELDS,
          });
          placementCache.set(placementId, placement);
        }

        const matchDetails = getMatchDetails(placement, rule, { change });
        if (!matchDetails.matched) {
          if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
            skippedPlacements.push(
              buildSkippedPlacementPreview({
                placement,
                rule,
                queryDateBegin,
                reason: "placement-not-eligible",
                matchDetails,
                change,
                transactionId,
              }),
            );
          }
          continue;
        }

        rawMatches.push({ placement, rule, queryDateBegin, change, transactionId });
      }
    }
  }

  const seen = new Set();
  const ownerCache = new Map();
  const placements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedDuplicate = 0;
  let skippedMissingToEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of rawMatches) {
    const dedupeKey = `${item.rule.key}:${item.placement.id}:${item.transactionId || item.queryDateBegin}`;
    if (seen.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(dedupeKey);

    const placement = await hydratePlacementOwners({
      bullhorn,
      session,
      placement: item.placement,
      ownerCache,
    });

    const transmissionPayload = buildInlineTransmission({
      placement,
      rule: item.rule,
    });

    if (transmissionPayload.recipientEnvelope.missingToEmail) {
      skippedMissingToEmail += 1;
      if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
        skippedPlacements.push(
          buildSkippedPlacementPreview({
            placement,
            rule: item.rule,
            queryDateBegin: item.queryDateBegin,
            reason: "missing-to-email",
            matchDetails: getMatchDetails(placement, item.rule, { change: item.change }),
            change: item.change,
            transactionId: item.transactionId,
          }),
        );
      }
      continue;
    }

    const sendLockEntityId = `${item.rule.key}:${placement.id}:${item.transactionId || item.queryDateBegin}`;
    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement-rule",
        entityId: sendLockEntityId,
        metadata: {
          businessDate: businessDateKey,
          queryDateBegin: item.queryDateBegin,
          ruleKey: item.rule.key,
          candidateId: placement?.candidate?.id || null,
          transactionId: item.transactionId || null,
        },
      });

      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
          skippedPlacements.push(
            buildSkippedPlacementPreview({
              placement,
              rule: item.rule,
              queryDateBegin: item.queryDateBegin,
              reason: "already-sent",
              matchDetails: getMatchDetails(placement, item.rule, { change: item.change }),
              change: item.change,
              transactionId: item.transactionId,
            }),
          );
        }
        continue;
      }
      if (sendLock.skipped) {
        sendLockUnavailable += 1;
      }
    }

    const reportRecord = buildPlacementReportRecord({
      placement,
      rule: item.rule,
      businessDateKey,
      queryDateBegin: item.queryDateBegin,
      change: item.change,
      transactionId: item.transactionId,
      recipientEnvelope: transmissionPayload.recipientEnvelope,
      sparkPostPayload: transmissionPayload,
      sendLock,
      inlineImagePaths: transmissionPayload.inlineImagePaths,
    });

    placements.push(reportRecord);
    sparkPostPayload.push(transmissionPayload);

    if (!config.DRY_RUN) {
      try {
        const primaryOwner = getPrimaryOwner(placement);
        const transmission = await sparkPost.sendInlineTransmission({
          ...transmissionPayload,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "notification",
            ruleKey: item.rule.key,
            recipientType: "owner",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            recipientFirstName: primaryOwner?.firstName || "",
            placementId: placement?.id || null,
            candidateId: placement?.candidate?.id || null,
            clientCorporationId: placement?.clientCorporation?.id || null,
            ownerId: primaryOwner?.id || null,
            ownerEmail: primaryOwner?.email || "",
            businessDate: businessDateKey,
            runDate: businessDateKey,
            context: {
              queryDateBegin: item.queryDateBegin,
              transactionId: item.transactionId || null,
              source: item.rule.source,
            },
            metadata: {
              inlineImagePaths: transmissionPayload.inlineImagePaths,
            },
          },
        });

        transmissions.push({
          placementId: placement.id,
          ruleKey: item.rule.key,
          transactionId: item.transactionId,
          transmission,
        });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "placement-rule",
            entityId: sendLockEntityId,
          }).catch(() => {});
        }
        throw error;
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
      totalMatchesBeforeDedupe: rawMatches.length,
      matchedPlacements: placements.length,
      skippedDuplicate,
      skippedMissingToEmail,
      skippedAlreadySent,
      sendLockUnavailable,
      skippedPreviewCount: skippedPlacements.length,
    },
    sparkPost: {
      sent: !config.DRY_RUN && placements.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    skippedPlacements,
    placements,
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
    logger.error(serializeError(error), "Americas internal placement notices sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  WORKFLOW_NAME,
  run,
};
