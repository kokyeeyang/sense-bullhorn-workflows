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
  buildInlineTransmission,
  buildReportRecord,
  buildSkippedItem,
  buildUtcDayWindowFromDateKey,
  findMatchingRule,
  findStatusChange,
  getBusinessDateParts,
  getOwner,
  getRuleMatchDetails,
  getTransactionId,
} = require("../utils/emeaPlacementAutoReplyUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "dateEnd",
  "employmentType",
  "owner(id,firstName,lastName,email,primaryDepartment(name))",
  "candidate(id,firstName,lastName,email,owner(id,firstName,lastName,email,primaryDepartment(name)))",
  "clientCorporation(id,name)",
  "jobOrder(id,title,employmentType,owner(id,firstName,lastName,email,primaryDepartment(name)))",
].join(",");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) return;
  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "emea-placement-auto-reply-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "emea-placement-auto-reply-sparkpost-payload",
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
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const businessDateKey =
    targetDate || config.EMEA_PLACEMENT_AUTO_REPLY_TARGET_DATE || business.dateKey;
  const queryCount = config.EMEA_PLACEMENT_AUTO_REPLY_QUERY_COUNT || QUERY_COUNT_DEFAULT;

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      queryCount,
      ruleCount: RULES.length,
    },
    "Starting EMEA placement auto-reply sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const window = buildUtcDayWindowFromDateKey(businessDateKey);
  const records = await bullhorn.queryPlacementEditHistoryByDateAddedRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: window.startMs,
    endMs: window.endMs,
    count: queryCount,
  });

  const placementCache = new Map();
  const ownerCache = new Map();
  const rawMatches = [];
  const skippedItems = [];

  for (const record of records) {
    const statusChange = findStatusChange(record);
    const placementId = Number(record?.targetEntity?.id || 0);
    const transactionId = getTransactionId(record);

    if (!statusChange || !placementId) {
      if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
        skippedItems.push(
          buildSkippedItem({
            placement: null,
            queryDate: businessDateKey,
            reason: statusChange ? "edit-history-missing-placement-id" : "edit-history-missing-status-change",
            statusChange,
            transactionId,
          }),
        );
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

    placement = await hydratePlacementOwners({ bullhorn, session, placement, ownerCache });
    placementCache.set(placementId, placement);

    const rule = findMatchingRule({ placement, statusChange });
    if (!rule) {
      if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
        skippedItems.push(
          buildSkippedItem({
            placement,
            queryDate: businessDateKey,
            reason: "placement-not-eligible",
            statusChange,
            transactionId,
            matchDetails: RULES.map((candidateRule) => ({
              ruleKey: candidateRule.key,
              ...getRuleMatchDetails({ placement, rule: candidateRule, statusChange }),
            })),
          }),
        );
      }
      continue;
    }

    rawMatches.push({ placement, rule, statusChange, transactionId, queryDate: businessDateKey });
  }

  const seen = new Set();
  const placements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedDuplicate = 0;
  let skippedMissingToEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of rawMatches) {
    const dedupeKey = `${item.rule.key}:${item.placement.id}:${item.transactionId || item.queryDate}`;
    if (seen.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(dedupeKey);

    const transmissionPayload = buildInlineTransmission({
      placement: item.placement,
      rule: item.rule,
    });

    if (transmissionPayload.recipientEnvelope.missingToEmail) {
      skippedMissingToEmail += 1;
      if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
        skippedItems.push(
          buildSkippedItem({
            placement: item.placement,
            rule: item.rule,
            queryDate: item.queryDate,
            reason: "missing-to-email",
            statusChange: item.statusChange,
            transactionId: item.transactionId,
          }),
        );
      }
      continue;
    }

    const sendLockEntityId = `${item.rule.key}|${item.placement.id}|${item.transactionId || item.queryDate}`;
    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement-status-change",
        entityId: sendLockEntityId,
        metadata: {
          ruleKey: item.rule.key,
          businessDate: businessDateKey,
          queryDate: item.queryDate,
          placementId: item.placement.id,
          transactionId: item.transactionId || null,
        },
      });

      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        if (skippedItems.length < SKIPPED_PREVIEW_LIMIT) {
          skippedItems.push(
            buildSkippedItem({
              placement: item.placement,
              rule: item.rule,
              queryDate: item.queryDate,
              reason: "already-sent",
              statusChange: item.statusChange,
              transactionId: item.transactionId,
            }),
          );
        }
        continue;
      }
      if (sendLock.skipped) sendLockUnavailable += 1;
    }

    placements.push(
      buildReportRecord({
        placement: item.placement,
        rule: item.rule,
        businessDateKey,
        queryDate: item.queryDate,
        statusChange: item.statusChange,
        transactionId: item.transactionId,
        recipientEnvelope: transmissionPayload.recipientEnvelope,
        sparkPostPayload: transmissionPayload,
        sendLock,
      }),
    );
    sparkPostPayload.push(transmissionPayload);

    if (!config.DRY_RUN) {
      try {
        const owner = getOwner(item.placement);
        const transmission = await sparkPost.sendInlineTransmission({
          ...transmissionPayload,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "notification",
            ruleKey: item.rule.key,
            recipientType: "owner",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            recipientFirstName: owner?.firstName || "",
            placementId: item.placement?.id || null,
            candidateId: item.placement?.candidate?.id || null,
            clientCorporationId: item.placement?.clientCorporation?.id || null,
            ownerId: owner?.id || null,
            ownerEmail: owner?.email || "",
            businessDate: businessDateKey,
            runDate: businessDateKey,
            context: {
              queryDate: item.queryDate,
              transactionId: item.transactionId || null,
              statusChange: item.statusChange,
            },
            metadata: {
              region: item.rule.region,
              templateVariant: item.rule.templateVariant,
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
            entityType: "placement-status-change",
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
    querySummary: {
      queryDate: businessDateKey,
      editHistoryRecordCount: records.length,
    },
    totals: {
      totalMatchesBeforeDedupe: rawMatches.length,
      matchedPlacements: placements.length,
      skippedDuplicate,
      skippedMissingToEmail,
      skippedAlreadySent,
      sendLockUnavailable,
      skippedPreviewCount: skippedItems.length,
    },
    rules: RULES.map((rule) => ({
      key: rule.key,
      region: rule.region,
      templateVariant: rule.templateVariant,
    })),
    sparkPost: {
      sent: !config.DRY_RUN && placements.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    skippedItems,
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
    logger.error(serializeError(error), "EMEA placement auto-reply sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  PLACEMENT_FIELDS,
  WORKFLOW_NAME,
  run,
};
