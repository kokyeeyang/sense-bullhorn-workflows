require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  WORKFLOW_RULES,
  buildAttachment,
  buildDateEndQueryDates,
  buildDelayedChangeDateKeys,
  buildInlineTransmission,
  buildReportRecord,
  buildUtcDayWindowFromDateKey,
  findAttachmentPath,
  findFieldChange,
  getBusinessDateParts,
  getRuleMatchDetails,
  getTransactionId,
  isTimedRuleDue,
  matchesChangeRule,
  matchesCommonRule,
} = require("../utils/placementTerminationWorkflowsUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");
const {
  releaseWorkflowSend,
  reserveWorkflowSend,
} = require("../stores/workflowSendLockStore");

const WORKFLOW_NAME = "placement-termination-workflows-sync";
const SKIPPED_PREVIEW_LIMIT = 50;
const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateEnd",
  "employmentType",
  "owner(id,firstName,lastName,email,primaryDepartment(name),reportToPerson(id,firstName,lastName,email))",
  "candidate(id,firstName,lastName,email,address(countryName),owner(id,firstName,lastName,email,primaryDepartment(name)))",
  "clientCorporation(id,name)",
  "jobOrder(id,title,employmentType,address(state,countryName),owner(id,firstName,lastName,email,primaryDepartment(name),reportToPerson(id,firstName,lastName,email)))",
].join(",");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) return;
  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "placement-termination-workflows-report", payload: report });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "placement-termination-workflows-sparkpost-payload",
    payload,
  });
}

function getQueryCount(config) {
  return config.PLACEMENT_TERMINATION_WORKFLOWS_QUERY_COUNT || 200;
}

function buildSkippedItem({
  placement,
  rule,
  queryDate = null,
  source = null,
  reason,
  change = null,
  transactionId = null,
  extra = {},
}) {
  return {
    placementId: placement?.id ?? null,
    ruleKey: rule?.key || null,
    source: source || rule?.source || null,
    queryDate,
    transactionId,
    reason,
    change: change
      ? {
          oldValue: change.oldValue ?? null,
          newValue: change.newValue ?? null,
        }
      : null,
    matchDetails: rule
      ? getRuleMatchDetails({ placement, rule, change })
      : null,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      dateEnd: placement?.dateEnd || null,
      candidate: placement?.candidate || null,
      owner: placement?.owner || placement?.jobOrder?.owner || null,
      jobOrder: placement?.jobOrder || null,
    },
    ...extra,
  };
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
      ownerCache.set(ownerId, await bullhorn.getCorporateUser({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        corporateUserId: ownerId,
      }));
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

async function collectDateEndMatches({ bullhorn, session, config, businessDateKey, businessHour, forceTimedRules }) {
  const matches = [];
  const skipped = [];
  const seen = new Set();
  const rules = WORKFLOW_RULES.filter((rule) => rule.source === "dateEnd");

  for (const rule of rules) {
    if (!isTimedRuleDue({ rule, businessHour, force: forceTimedRules })) {
      continue;
    }

    for (const queryDate of buildDateEndQueryDates({ rule, businessDateKey })) {
      const window = buildUtcDayWindowFromDateKey(queryDate);
      const placements = await bullhorn.queryPlacementsByDateEndRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: getQueryCount(config),
        fieldsOverride: PLACEMENT_FIELDS,
      });

      for (const placement of placements) {
        const key = `${rule.key}:${placement.id}:${queryDate}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (!matchesCommonRule(placement, rule)) {
          if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
            skipped.push(buildSkippedItem({
              placement,
              rule,
              queryDate,
              source: "dateEnd",
              reason: "date-end-placement-not-eligible",
            }));
          }
          continue;
        }

        matches.push({ placement, rule, source: "dateEnd", queryDate });
      }
    }
  }

  return { matches, skipped };
}

async function collectDailyChangeMatches({ bullhorn, session, config, businessDateKey }) {
  const matches = [];
  const skipped = [];
  const rules = WORKFLOW_RULES.filter((rule) =>
    ["statusChange", "terminationReasonChange"].includes(rule.source) && !rule.delayHours,
  );
  const dateKeysByRule = new Map(rules.map((rule) => [
    rule.key,
    buildDelayedChangeDateKeys({
      businessDateKey,
      delayDays: rule.delayDays || 0,
      weekendAdjust: rule.weekendAdjust,
    }),
  ]));

  for (const dateKey of Array.from(new Set(Array.from(dateKeysByRule.values()).flat()))) {
    const window = buildUtcDayWindowFromDateKey(dateKey);
    const records = await bullhorn.queryPlacementEditHistoryByDateAddedRange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      startMs: window.startMs,
      endMs: window.endMs,
      count: getQueryCount(config),
    });

    for (const record of records) {
      const placementId = Number(record?.targetEntity?.id || 0);
      if (!placementId) {
        if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
          skipped.push({
            placementId: null,
            ruleKey: null,
            source: "editHistory",
            queryDate: dateKey,
            transactionId: getTransactionId(record),
            reason: "edit-history-missing-placement-id",
          });
        }
        continue;
      }

      const placement = await bullhorn.getPlacementByIdWithFields({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        placementId,
        fields: PLACEMENT_FIELDS,
      });

      for (const rule of rules) {
        if (!dateKeysByRule.get(rule.key).includes(dateKey)) continue;
        const change = rule.source === "terminationReasonChange"
          ? findFieldChange(record, ["terminationReason", "terminationreason"])
          : findFieldChange(record, ["status"]);
        if (!change) {
          if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
            skipped.push(buildSkippedItem({
              placement,
              rule,
              queryDate: dateKey,
              source: rule.source,
              transactionId: getTransactionId(record),
              reason: rule.source === "terminationReasonChange"
                ? "edit-history-missing-termination-reason-change"
                : "edit-history-missing-status-change",
            }));
          }
          continue;
        }
        if (!matchesChangeRule({ placement, rule, change })) {
          if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
            skipped.push(buildSkippedItem({
              placement,
              rule,
              queryDate: dateKey,
              source: rule.source,
              change,
              transactionId: getTransactionId(record),
              reason: "change-placement-not-eligible",
            }));
          }
          continue;
        }
        matches.push({
          placement,
          rule,
          source: rule.source,
          queryDate: dateKey,
          change,
          transactionId: getTransactionId(record),
        });
      }
    }
  }

  return { matches, skipped };
}

async function collectHourlyChangeMatches({ bullhorn, session, config, baseDate }) {
  const matches = [];
  const skipped = [];
  const rules = WORKFLOW_RULES.filter((rule) => rule.source === "statusChange" && rule.delayHours);
  if (rules.length === 0) return { matches, skipped };

  const endMs = baseDate.getTime() - Math.min(...rules.map((rule) => rule.delayHours)) * 60 * 60 * 1000;
  const startMs = endMs - 60 * 60 * 1000;
  const records = await bullhorn.queryPlacementEditHistoryByDateAddedRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs,
    endMs,
    count: getQueryCount(config),
  });

  for (const record of records) {
    const placementId = Number(record?.targetEntity?.id || 0);
    const change = findFieldChange(record, ["status"]);
    if (!placementId) {
      if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
        skipped.push({
          placementId: null,
          ruleKey: null,
          source: "statusChange",
          queryDate: new Date(startMs).toISOString(),
          transactionId: getTransactionId(record),
          reason: "edit-history-missing-placement-id",
        });
      }
      continue;
    }
    const placement = await bullhorn.getPlacementByIdWithFields({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      placementId,
      fields: PLACEMENT_FIELDS,
    });

    for (const rule of rules) {
      if (!change) {
        if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
          skipped.push(buildSkippedItem({
            placement,
            rule,
            queryDate: new Date(startMs).toISOString(),
            source: rule.source,
            transactionId: getTransactionId(record),
            reason: "edit-history-missing-status-change",
          }));
        }
        continue;
      }
      if (matchesChangeRule({ placement, rule, change })) {
        matches.push({
          placement,
          rule,
          source: rule.source,
          queryDate: new Date(startMs).toISOString(),
          change,
          transactionId: getTransactionId(record),
        });
      } else if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
        skipped.push(buildSkippedItem({
          placement,
          rule,
          queryDate: new Date(startMs).toISOString(),
          source: rule.source,
          change,
          transactionId: getTransactionId(record),
          reason: "change-placement-not-eligible",
        }));
      }
    }
  }

  return { matches, skipped };
}

function loadRuleAttachments(rule) {
  const attachmentPaths = [];
  const attachments = [];
  if (!rule.attachments?.length) return { attachmentPaths, attachments, missing: false };

  const attachmentPath = findAttachmentPath(rule.attachments);
  if (!attachmentPath) return { attachmentPaths, attachments, missing: true };

  attachmentPaths.push(attachmentPath);
  attachments.push(buildAttachment(attachmentPath));
  return { attachmentPaths, attachments, missing: false };
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const baseDate = new Date();
  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.PLACEMENT_TERMINATION_WORKFLOWS_TARGET_DATE || business.dateKey;
  const forceTimedRules = Boolean(targetDate || config.PLACEMENT_TERMINATION_WORKFLOWS_TARGET_DATE);

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      queryCount: getQueryCount(config),
      ruleCount: WORKFLOW_RULES.length,
    },
    "Starting placement termination workflows sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const dateEndResult = await collectDateEndMatches({
    bullhorn,
    session,
    config,
    businessDateKey,
    businessHour: business.hour,
    forceTimedRules,
  });
  const dailyChangeResult = await collectDailyChangeMatches({ bullhorn, session, config, businessDateKey });
  const hourlyChangeResult = await collectHourlyChangeMatches({ bullhorn, session, config, baseDate });

  const rawMatches = [
    ...dateEndResult.matches,
    ...dailyChangeResult.matches,
    ...hourlyChangeResult.matches,
  ];
  const seen = new Set();
  const ownerCache = new Map();
  const attachmentCache = new Map();
  const placements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  const skippedItems = [...dateEndResult.skipped, ...dailyChangeResult.skipped, ...hourlyChangeResult.skipped];
  let skippedDuplicate = 0;
  let skippedMissingToEmail = 0;
  let skippedMissingAttachment = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of rawMatches) {
    const dedupeKey = `${item.rule.key}:${item.placement?.id}:${item.transactionId || item.queryDate}`;
    if (seen.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(dedupeKey);

    const placement = await hydratePlacementOwners({ bullhorn, session, placement: item.placement, ownerCache });
    let attachmentResult = attachmentCache.get(item.rule.key);
    if (!attachmentResult) {
      attachmentResult = loadRuleAttachments(item.rule);
      attachmentCache.set(item.rule.key, attachmentResult);
    }
    if (attachmentResult.missing) {
      skippedMissingAttachment += 1;
      if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
        skippedItems.push(buildSkippedItem({
          placement,
          rule: item.rule,
          source: item.source,
          queryDate: item.queryDate,
          change: item.change,
          transactionId: item.transactionId,
          reason: "missing-attachment",
          extra: {
            attachmentCandidates: item.rule.attachments || [],
          },
        }));
      }
      continue;
    }

    const transmissionPayload = buildInlineTransmission({
      placement,
      rule: item.rule,
      attachments: attachmentResult.attachments,
    });
    if (transmissionPayload.recipientEnvelope.missingToEmail) {
      skippedMissingToEmail += 1;
      if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
        skippedItems.push(buildSkippedItem({
          placement,
          rule: item.rule,
          source: item.source,
          queryDate: item.queryDate,
          change: item.change,
          transactionId: item.transactionId,
          reason: "missing-to-email",
          extra: {
            recipientEnvelope: transmissionPayload.recipientEnvelope,
          },
        }));
      }
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement",
        entityId: `${item.rule.key}|${placement.id}|${item.transactionId || item.queryDate}`,
        metadata: {
          ruleKey: item.rule.key,
          businessDate: businessDateKey,
          source: item.source,
          queryDate: item.queryDate,
          transactionId: item.transactionId || null,
        },
      });
      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
          skippedItems.push(buildSkippedItem({
            placement,
            rule: item.rule,
            source: item.source,
            queryDate: item.queryDate,
            change: item.change,
            transactionId: item.transactionId,
            reason: "already-sent",
            extra: { sendLock },
          }));
        }
        continue;
      }
      if (sendLock.skipped) sendLockUnavailable += 1;
    }

    const reportRecord = buildReportRecord({
      placement,
      rule: item.rule,
      source: item.source,
      queryDate: item.queryDate,
      change: item.change,
      transactionId: item.transactionId,
      transmission: transmissionPayload,
      attachmentPaths: attachmentResult.attachmentPaths,
      sendLock,
    });
    placements.push(reportRecord);
    sparkPostPayload.push(reportRecord.sparkPostPayload);

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
            recipientFirstName: placement?.candidate?.firstName || "",
            placementId: placement?.id || null,
            candidateId: placement?.candidate?.id || null,
            clientCorporationId: placement?.clientCorporation?.id || null,
            ownerId:
              placement?.owner?.id ||
              placement?.candidate?.owner?.id ||
              placement?.jobOrder?.owner?.id ||
              null,
            ownerEmail:
              placement?.owner?.email ||
              placement?.candidate?.owner?.email ||
              placement?.jobOrder?.owner?.email ||
              "",
            businessDate: businessDateKey,
            runDate: businessDateKey,
            context: {
              source: item.source,
              queryDate: item.queryDate,
              transactionId: item.transactionId || null,
            },
            metadata: {
              attachmentPaths: attachmentResult.attachmentPaths,
            },
          },
        });
        transmissions.push({ placementId: placement.id, ruleKey: item.rule.key, transmission });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "placement",
            entityId: `${item.rule.key}|${placement.id}|${item.transactionId || item.queryDate}`,
          }).catch((releaseError) => {
            logger.warn({ message: releaseError.message, placementId: placement.id }, "Failed to release termination workflow send lock");
          });
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
    architecture: "combined workflow with separate auditable rule definitions",
    totals: {
      totalMatchesBeforeDedupe: rawMatches.length,
      matchedPlacements: placements.length,
      skippedDuplicate,
      skippedMissingToEmail,
      skippedMissingAttachment,
      skippedAlreadySent,
      sendLockUnavailable,
      skippedPreviewCount: skippedItems.length,
    },
    sparkPost: {
      sent: !config.DRY_RUN && placements.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    rules: WORKFLOW_RULES.map((rule) => ({ key: rule.key, source: rule.source })),
    skippedItems,
    placements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: sparkPostPayload });

  return buildWorkflowResult({
    workflowName: WORKFLOW_NAME,
    report,
    artifacts: { reportPath, sparkPostPayloadReportPath },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Placement termination workflows sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  WORKFLOW_NAME,
  run,
  writeSparkPostPayloadReport,
};
