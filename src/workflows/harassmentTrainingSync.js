require("dotenv").config();

const fs = require("node:fs/promises");

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  buildAttachmentName,
  buildHarassmentTrainingTransmission,
  buildPlacementReportRecord,
  buildQueryPlan,
  buildUtcDayWindowFromDateKey,
  findRuleForPlacement,
  getAttachmentPaths,
  getBusinessDateKey,
  getIllinoisMaineMatchDetails,
} = require("../utils/harassmentTrainingUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const SKIPPED_PREVIEW_LIMIT = 25;

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "dateLastModified",
  "employmentType",
  "customText1",
  "customText2",
  "customText3",
  "customText4",
  "customText5",
  "customText6",
  "customText7",
  "customText8",
  "customText9",
  "customText10",
  "customText11",
  "customText12",
  "customText13",
  "customText14",
  "customText15",
  "customText16",
  "customText17",
  "customText18",
  "customText19",
  "customText20",
  "customTextBlock1",
  "candidate(id,firstName,lastName,email,address(countryName),owner(id,firstName,lastName,email))",
  "clientCorporation(id,name)",
  "jobOrder(id,title,employmentType,address(state,countryName),owner(id,firstName,lastName,email))",
].join(",");

function parseConfiguredFields(value) {
  return String(value || "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function buildPlacementFields(config) {
  const extraFields = parseConfiguredFields(config.HARASSMENT_TRAINING_FLAG_FIELDS);
  return [PLACEMENT_FIELDS, ...extraFields].join(",");
}

function getTemplateId(config, rule = null) {
  const variantTemplateKeyByVariant = {
    "onboarding-confirmation": "HARASSMENT_TRAINING_ONBOARDING_SPARKPOST_TEMPLATE_ID",
    "state-training-notice": "HARASSMENT_TRAINING_STATE_NOTICE_SPARKPOST_TEMPLATE_ID",
    "california-training-notice": "HARASSMENT_TRAINING_CALIFORNIA_SPARKPOST_TEMPLATE_ID",
  };
  const variantKey = rule ? variantTemplateKeyByVariant[rule.templateVariant] : null;
  return (variantKey ? config[variantKey] : null) || config.HARASSMENT_TRAINING_SPARKPOST_TEMPLATE_ID || null;
}

function hasHarassmentTrainingTemplateConfig(config) {
  return Boolean(
    config.HARASSMENT_TRAINING_SPARKPOST_TEMPLATE_ID ||
      (
        config.HARASSMENT_TRAINING_ONBOARDING_SPARKPOST_TEMPLATE_ID &&
        config.HARASSMENT_TRAINING_STATE_NOTICE_SPARKPOST_TEMPLATE_ID &&
        config.HARASSMENT_TRAINING_CALIFORNIA_SPARKPOST_TEMPLATE_ID
      ),
  );
}

function validateSparkPostConfig(config) {
  const missing = [];
  if (!config.DRY_RUN && !config.SPARKPOST_API_KEY) {
    missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
  if (!hasHarassmentTrainingTemplateConfig(config)) {
    missing.push(
      "HARASSMENT_TRAINING_*_SPARKPOST_TEMPLATE_ID or HARASSMENT_TRAINING_SPARKPOST_TEMPLATE_ID",
    );
  }

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "harassment-training-report", payload: report });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "harassment-training-sparkpost-payload",
    payload,
  });
}

function extractFieldChanges(fieldChanges) {
  if (Array.isArray(fieldChanges)) {
    return fieldChanges;
  }
  if (Array.isArray(fieldChanges?.data)) {
    return fieldChanges.data;
  }
  return [];
}

function findStatusChange(editHistoryRecord) {
  return extractFieldChanges(editHistoryRecord?.fieldChanges).find(
    (change) => (change.columnName || change.fieldName) === "status",
  ) || null;
}

function getTransactionId(record) {
  return record?.transactionID || record?.transactionId || null;
}

async function loadAttachment({ config, rule }) {
  const attachmentPaths = getAttachmentPaths({ config, rule });
  if (attachmentPaths.length === 0) {
    return {
      attachmentPaths: [],
      attachments: [],
      missing: true,
    };
  }

  const attachments = [];
  for (const attachmentPath of attachmentPaths) {
    const data = await fs.readFile(attachmentPath);
    attachments.push({
      name: buildAttachmentName(attachmentPath),
      type: "application/pdf",
      data: data.toString("base64"),
    });
  }

  return {
    attachmentPaths,
    attachments,
    missing: false,
  };
}

async function collectDateBeginMatches({ bullhorn, session, config, businessDateKey, queryPlan }) {
  const matches = [];
  const skipped = [];
  const placementFields = buildPlacementFields(config);

  for (const dateKey of queryPlan.dateBeginDateKeys) {
    const window = buildUtcDayWindowFromDateKey(dateKey);
    const placements = await bullhorn.queryPlacementsByDateBeginRange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      startMs: window.startMs,
      endMs: window.endMs,
      count: config.HARASSMENT_TRAINING_QUERY_COUNT,
      fieldsOverride: placementFields,
    });

    for (const placement of placements) {
      const rule = findRuleForPlacement({
        placement,
        source: "dateBegin",
        config,
      });

      if (!rule) {
        if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
          skipped.push({
            placementId: placement?.id ?? null,
            source: "dateBegin",
            reason: "date-begin-placement-not-eligible",
            queryDate: dateKey,
            matchDetails: getIllinoisMaineMatchDetails(placement, {
              flagFields: config.HARASSMENT_TRAINING_FLAG_FIELDS,
              extraStatuses: config.HARASSMENT_TRAINING_EXTRA_DATE_BEGIN_STATUSES,
            }),
          });
        }
        continue;
      }

      matches.push({
        placement,
        rule,
        source: "dateBegin",
        queryDate: dateKey,
        businessDateKey,
      });
    }
  }

  return { matches, skipped };
}

async function collectStatusChangeMatches({ bullhorn, session, config, businessDateKey, queryPlan }) {
  const matches = [];
  const skipped = [];
  const seenTransactions = new Set();
  const placementFields = buildPlacementFields(config);

  for (const dateKey of queryPlan.statusChangeDateKeys) {
    const window = buildUtcDayWindowFromDateKey(dateKey);
    const editHistoryRecords = await bullhorn.queryPlacementEditHistoryByDateAddedRange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      startMs: window.startMs,
      endMs: window.endMs,
      count: config.HARASSMENT_TRAINING_QUERY_COUNT,
    });

    for (const record of editHistoryRecords) {
      const statusChange = findStatusChange(record);
      const placementId = Number(record?.targetEntity?.id || 0);
      const transactionId = getTransactionId(record);

      if (!statusChange || !placementId) {
        if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
          skipped.push({
            placementId: placementId || null,
            transactionId,
            source: "statusChange",
            reason: statusChange ? "missing-placement-id" : "edit-history-missing-status-change",
            queryDate: dateKey,
          });
        }
        continue;
      }

      const dedupeKey = transactionId || `${placementId}:${dateKey}`;
      if (seenTransactions.has(dedupeKey)) {
        continue;
      }
      seenTransactions.add(dedupeKey);

      const placement = await bullhorn.getPlacementByIdWithFields({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        placementId,
        fields: placementFields,
      });
      const rule = findRuleForPlacement({
        placement,
        statusChange,
        source: "statusChange",
        config,
      });

      if (!rule) {
        if (skipped.length < SKIPPED_PREVIEW_LIMIT) {
          skipped.push({
            placementId,
            transactionId,
            source: "statusChange",
            reason: "status-change-placement-not-eligible",
            queryDate: dateKey,
            statusChange: {
              oldValue: statusChange.oldValue ?? null,
              newValue: statusChange.newValue ?? null,
            },
          });
        }
        continue;
      }

      matches.push({
        placement,
        rule,
        source: "statusChange",
        queryDate: dateKey,
        businessDateKey,
        statusChange,
        transactionId,
      });
    }
  }

  return { matches, skipped };
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const businessDateKey = targetDate || config.HARASSMENT_TRAINING_TARGET_DATE || getBusinessDateKey();
  const queryPlan = buildQueryPlan({ businessDateKey });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      queryPlan,
      sparkPostTemplateId: getTemplateId(config),
      queryCount: config.HARASSMENT_TRAINING_QUERY_COUNT,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting harassment training sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const dateBeginResult = await collectDateBeginMatches({
    bullhorn,
    session,
    config,
    businessDateKey,
    queryPlan,
  });
  const statusChangeResult = await collectStatusChangeMatches({
    bullhorn,
    session,
    config,
    businessDateKey,
    queryPlan,
  });

  const rawMatches = [...dateBeginResult.matches, ...statusChangeResult.matches];
  const seenPlacements = new Set();
  const matchedItems = [];
  let skippedDuplicatePlacement = 0;

  for (const item of rawMatches) {
    const placementId = item.placement?.id;
    if (seenPlacements.has(placementId)) {
      skippedDuplicatePlacement += 1;
      continue;
    }
    seenPlacements.add(placementId);
    matchedItems.push(item);
  }

  const attachmentCache = new Map();
  const placements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  const skippedEvents = [...dateBeginResult.skipped, ...statusChangeResult.skipped];
  let skippedMissingCandidateEmail = 0;
  let skippedMissingAttachment = 0;
  let missingOwnerEmail = 0;

  for (const item of matchedItems) {
    let attachmentResult = attachmentCache.get(item.rule.key);
    if (!attachmentResult) {
      attachmentResult = await loadAttachment({ config, rule: item.rule });
      attachmentCache.set(item.rule.key, attachmentResult);
    }

    if (attachmentResult.missing) {
      skippedMissingAttachment += 1;
      if (skippedEvents.length < SKIPPED_PREVIEW_LIMIT) {
        skippedEvents.push({
          placementId: item.placement?.id ?? null,
          source: item.source,
          reason: "missing-attachment-path",
          state: item.rule.stateLabel,
          attachmentConfigKey: item.rule.attachmentConfigKey,
        });
      }
      continue;
    }

    const transmissionPayload = buildHarassmentTrainingTransmission({
      placement: item.placement,
      rule: item.rule,
      templateId: getTemplateId(config, item.rule),
      config,
      attachments: attachmentResult.attachments,
    });

    if (transmissionPayload.recipientEnvelope.missingCandidateEmail) {
      skippedMissingCandidateEmail += 1;
      continue;
    }

    if (transmissionPayload.recipientEnvelope.missingOwnerEmail) {
      missingOwnerEmail += 1;
    }

    const templateId = getTemplateId(config, item.rule);
    const record = buildPlacementReportRecord({
      placement: item.placement,
      rule: item.rule,
      templateId,
      businessDateKey,
      source: item.source,
      queryDate: item.queryDate,
      statusChange: item.statusChange,
      transactionId: item.transactionId,
      recipientEnvelope: transmissionPayload.recipientEnvelope,
      attachmentPaths: attachmentResult.attachmentPaths,
      sparkPostPayload: {
        content: {
          template_id: templateId,
          from: transmissionPayload.from,
          headers: transmissionPayload.headers,
          attachments: transmissionPayload.attachments.map((attachment) => ({
            name: attachment.name,
            type: attachment.type,
            data: "[base64 omitted]",
          })),
        },
        recipients: transmissionPayload.recipients,
      },
    });

    placements.push(record);
    sparkPostPayload.push(record.sparkPostPayload);

    if (!config.DRY_RUN) {
      const transmission = await sparkPost.sendTransmission({
        templateId,
        recipients: transmissionPayload.recipients,
        headers: transmissionPayload.headers,
        attachments: transmissionPayload.attachments,
        from: transmissionPayload.from,
      });

      transmissions.push({
        placementId: item.placement?.id ?? null,
        state: item.rule.stateLabel,
        source: item.source,
        transactionId: item.transactionId || null,
        transmission,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    businessDate: businessDateKey,
    queryPlan,
    totals: {
      totalMatchesBeforeDedupe: rawMatches.length,
      matchedPlacements: placements.length,
      skippedDuplicatePlacement,
      skippedMissingCandidateEmail,
      skippedMissingAttachment,
      missingOwnerEmail,
      skippedPreviewCount: skippedEvents.length,
    },
    sparkPost: {
      defaultTemplateId: getTemplateId(config),
      sent: !config.DRY_RUN && placements.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    skippedEvents,
    placements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: sparkPostPayload });
  logger.info({ reportPath }, "Harassment training report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "Harassment training SparkPost payload report written",
  );

  return buildWorkflowResult({
    workflowName: "harassment-training-sync",
    report,
    artifacts: {
      reportPath,
      sparkPostPayloadReportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Harassment training sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  getTemplateId,
  run,
  writeSparkPostPayloadReport,
};
