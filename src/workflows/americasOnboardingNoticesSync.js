require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");

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
  buildDateBeginQueryDates,
  buildPlacementReportRecord,
  buildRuleExecutionPlan,
  buildSkippedPlacementPreview,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
} = require("../utils/americasOnboardingNoticesUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "employmentType",
  "candidate(id,firstName,lastName,email,address(countryName),owner(id,firstName,lastName,email))",
  "clientCorporation(id,name,address(countryName))",
  "jobOrder(id,title,address(state,countryName))",
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
    filePrefix: "americas-onboarding-notices-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "americas-onboarding-notices-sparkpost-payload",
    payload,
  });
}

function findAttachmentPath(attachmentCandidates) {
  for (const candidate of attachmentCandidates) {
    const resolved = path.resolve(candidate);
    try {
      require("node:fs").accessSync(resolved);
      return resolved;
    } catch {
      continue;
    }
  }
  return null;
}

async function loadRuleAttachments(rule) {
  const attachmentPaths = [];
  const attachments = [];
  if (!rule.attachments?.length) {
    return { attachmentPaths, attachments, missing: false };
  }

  const attachmentPath = findAttachmentPath(rule.attachments);
  if (!attachmentPath) {
    return { attachmentPaths, attachments, missing: true };
  }

  const data = await fs.readFile(attachmentPath);
  attachmentPaths.push(attachmentPath);
  attachments.push({
    name: path.basename(attachmentPath),
    type: "application/pdf",
    data: data.toString("base64"),
  });

  return { attachmentPaths, attachments, missing: false };
}

async function run({ targetDate } = {}) {
  const config = loadConfig("americas-onboarding-notices-sync");
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey =
    targetDate || config.AMERICAS_ONBOARDING_NOTICES_TARGET_DATE || business.dateKey;
  const forceTimedRules = Boolean(targetDate || config.AMERICAS_ONBOARDING_NOTICES_TARGET_DATE);
  const queryCount = config.AMERICAS_ONBOARDING_NOTICES_QUERY_COUNT || QUERY_COUNT_DEFAULT;
  const extraStatuses = config.AMERICAS_ONBOARDING_NOTICES_EXTRA_DATE_BEGIN_STATUSES || "";

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      ruleCount: RULES.length,
      queryCount,
      extraStatuses,
    },
    "Starting Americas onboarding notices sync",
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
      if (rulePlan.queryDateBeginDates.length === 0) {
        continue;
      }

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
          const matchDetails = getMatchDetails(placement, rule, { extraStatuses });
          if (!matchDetails.matched) {
            if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
              skippedPlacements.push(buildSkippedPlacementPreview({
                placement,
                rule,
                queryDateBegin,
                reason: "placement-not-eligible",
                matchDetails,
              }));
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
          if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
            skippedPlacements.push({
              placementId: placementId || null,
              queryDateBegin,
              source: rule.source,
              ruleKey: rule.key,
              transactionId,
              reason: change ? "missing-placement-id" : "edit-history-missing-status-change",
              change: change
                ? {
                    oldValue: change.oldValue ?? null,
                    newValue: change.newValue ?? null,
                  }
                : null,
            });
          }
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

        const matchDetails = getMatchDetails(placement, rule, { extraStatuses, change });
        if (!matchDetails.matched) {
          if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
            skippedPlacements.push(buildSkippedPlacementPreview({
              placement,
              rule,
              queryDateBegin,
              reason: "placement-not-eligible",
              matchDetails,
              change,
              transactionId,
            }));
          }
          continue;
        }

        rawMatches.push({ placement, rule, queryDateBegin, change, transactionId });
      }
    }
  }

  const seen = new Set();
  const attachmentCache = new Map();
  const placements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedDuplicate = 0;
  let skippedMissingToEmail = 0;
  let skippedMissingAttachment = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of rawMatches) {
    const dedupeKey = `${item.rule.key}:${item.placement.id}:${item.transactionId || item.queryDateBegin}`;
    if (seen.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(dedupeKey);

    let attachmentResult = attachmentCache.get(item.rule.key);
    if (!attachmentResult) {
      attachmentResult = await loadRuleAttachments(item.rule);
      attachmentCache.set(item.rule.key, attachmentResult);
    }

    if (attachmentResult.missing) {
      skippedMissingAttachment += 1;
      if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
        skippedPlacements.push(buildSkippedPlacementPreview({
          placement: item.placement,
          rule: item.rule,
          queryDateBegin: item.queryDateBegin,
          reason: "missing-attachment",
          matchDetails: getMatchDetails(item.placement, item.rule, { extraStatuses, change: item.change }),
          change: item.change,
          transactionId: item.transactionId,
        }));
      }
      continue;
    }

    const transmissionPayload = buildTransmission({
      placement: item.placement,
      rule: item.rule,
      config,
      attachments: attachmentResult.attachments,
    });

    if (transmissionPayload.recipientEnvelope.missingToEmail) {
      skippedMissingToEmail += 1;
      if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
        skippedPlacements.push(buildSkippedPlacementPreview({
          placement: item.placement,
          rule: item.rule,
          queryDateBegin: item.queryDateBegin,
          reason: "missing-to-email",
          matchDetails: getMatchDetails(item.placement, item.rule, { extraStatuses, change: item.change }),
          change: item.change,
          transactionId: item.transactionId,
        }));
      }
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement-rule",
        entityId: `${item.placement.id}:${item.rule.key}`,
        metadata: {
          businessDate: businessDateKey,
          queryDateBegin: item.queryDateBegin,
          ruleKey: item.rule.key,
          candidateId: item.placement?.candidate?.id || null,
        },
      });

      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        if (skippedPlacements.length < SKIPPED_PREVIEW_LIMIT) {
          skippedPlacements.push(buildSkippedPlacementPreview({
            placement: item.placement,
          rule: item.rule,
          queryDateBegin: item.queryDateBegin,
          reason: "already-sent",
          matchDetails: getMatchDetails(item.placement, item.rule, { extraStatuses, change: item.change }),
          change: item.change,
          transactionId: item.transactionId,
        }));
        }
        continue;
      }
      if (sendLock.skipped) {
        sendLockUnavailable += 1;
      }
    }

    const reportRecord = buildPlacementReportRecord({
      placement: item.placement,
      rule: item.rule,
      businessDateKey,
      queryDateBegin: item.queryDateBegin,
      change: item.change,
      transactionId: item.transactionId,
      recipientEnvelope: transmissionPayload.recipientEnvelope,
      sparkPostPayload: transmissionPayload,
      attachmentPaths: attachmentResult.attachmentPaths,
      sendLock,
    });

    placements.push(reportRecord);
    sparkPostPayload.push(transmissionPayload);

    if (!config.DRY_RUN) {
      try {
        const transmission = await sparkPost.sendInlineTransmission({
          ...transmissionPayload,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "notification",
            ruleKey: item.rule.key,
            recipientType: item.rule.recipientType || "candidate",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            recipientFirstName: item.placement?.candidate?.firstName || "",
            placementId: item.placement?.id || null,
            candidateId: item.placement?.candidate?.id || null,
            clientCorporationId: item.placement?.clientCorporation?.id || null,
            businessDate: businessDateKey,
            runDate: businessDateKey,
            context: {
              queryDateBegin: item.queryDateBegin,
              transactionId: item.transactionId || null,
            },
            metadata: {
              attachmentPaths: attachmentResult.attachmentPaths,
            },
          },
        });
        transmissions.push({
          placementId: item.placement.id,
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
            entityId: `${item.placement.id}:${item.rule.key}`,
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
    extraStatuses,
    rulePlans,
    querySummaries,
    totals: {
      totalMatchesBeforeDedupe: rawMatches.length,
      matchedPlacements: placements.length,
      skippedDuplicate,
      skippedMissingToEmail,
      skippedMissingAttachment,
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
    logger.error(serializeError(error), "Americas onboarding notices sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  WORKFLOW_NAME,
  run,
};
