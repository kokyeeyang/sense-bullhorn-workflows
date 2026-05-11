require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  BENEFITS_REMINDER_STAGES,
  NEW_YORK_BENEFITS_RULE_KEY,
  buildBenefitsReminderTransmission,
  buildNewYorkBenefitsReminderTransmission,
  buildPlacementReportRecord,
  buildQueryPlan,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getStageTemplateId,
  matchesBenefitsReminderPlacement,
  matchesNewYorkBenefitsReminderPlacement,
} = require("../utils/placementBenefitsReminderUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

const SEND_AT_PACIFIC_HOUR = 17;

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) {
    missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }

  for (const stage of BENEFITS_REMINDER_STAGES) {
    if (!getStageTemplateId({ config, stage })) {
      missing.push(stage.templateConfigKey);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "placement-benefits-reminder-report", payload: report });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "placement-benefits-reminder-sparkpost-payload",
    payload,
  });
}

async function hydratePlacementOwners({ bullhorn, session, placement, candidateCache, ownerCache }) {
  const candidateId = placement?.candidate?.id || null;
  let candidate = placement?.candidate || null;

  if (candidateId) {
    if (candidateCache.has(candidateId)) {
      candidate = candidateCache.get(candidateId);
    } else {
      candidate = await bullhorn.getCandidate({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        candidateId,
      });
      candidateCache.set(candidateId, candidate);
    }
  }

  const candidateOwnerId = candidate?.owner?.id || null;
  if (candidateOwnerId) {
    let candidateOwner = ownerCache.get(candidateOwnerId);
    if (!candidateOwner) {
      candidateOwner = await bullhorn.getCorporateUser({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        corporateUserId: candidateOwnerId,
      });
      ownerCache.set(candidateOwnerId, candidateOwner);
    }

    candidate = {
      ...candidate,
      owner: {
        ...candidate?.owner,
        ...candidateOwner,
      },
    };
  }

  const jobOrderOwnerId = placement?.jobOrder?.owner?.id || null;
  let jobOrderOwner = placement?.jobOrder?.owner || null;
  if (jobOrderOwnerId) {
    jobOrderOwner = ownerCache.get(jobOrderOwnerId) || jobOrderOwner;
    if (!ownerCache.has(jobOrderOwnerId)) {
      jobOrderOwner = await bullhorn.getCorporateUser({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        corporateUserId: jobOrderOwnerId,
      });
      ownerCache.set(jobOrderOwnerId, jobOrderOwner);
    }
  }

  return {
    ...placement,
    candidate: {
      ...placement?.candidate,
      ...candidate,
      owner: candidate?.owner || placement?.candidate?.owner || null,
    },
    jobOrder: {
      ...placement?.jobOrder,
      owner: {
        ...placement?.jobOrder?.owner,
        ...jobOrderOwner,
      },
    },
  };
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const configuredTargetDate = config.PLACEMENT_BENEFITS_REMINDER_TARGET_DATE || null;
  const businessDateKey = targetDate || configuredTargetDate || business.dateKey;
  const forceTimedRun = Boolean(targetDate || configuredTargetDate);
  const isPacificWeekday = business.dayOfWeek >= 1 && business.dayOfWeek <= 5;

  if (!forceTimedRun && (business.hour !== SEND_AT_PACIFIC_HOUR || !isPacificWeekday)) {
    const report = {
      generatedAt: new Date().toISOString(),
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      expectedPacificHour: SEND_AT_PACIFIC_HOUR,
      skippedReason: !isPacificWeekday ? "outside-pacific-weekday" : "outside-send-hour",
      queryPlan: [],
      totals: {
        totalPlacementsQueried: 0,
        matchedPlacements: 0,
        day10Count: 0,
        newYorkDay10Count: 0,
        day21Count: 0,
        day26Count: 0,
        skippedNonMatchingPlacement: 0,
        skippedMissingCandidateEmail: 0,
        missingCandidateOwnerEmail: 0,
        missingJobOrderOwnerEmail: 0,
      },
      sparkPost: {
        sent: false,
        transmissionCount: 0,
        payloadCount: 0,
        transmissions: [],
        payload: [],
      },
      placements: [],
    };

    const reportPath = await writeChangesReport({ report });
    const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: [] });

    return buildWorkflowResult({
      workflowName: "placement-benefits-reminder-sync",
      report,
      artifacts: {
        reportPath,
        sparkPostPayloadReportPath,
      },
    });
  }

  const queryPlan = buildQueryPlan({ businessDateKey });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      expectedPacificHour: SEND_AT_PACIFIC_HOUR,
      queryCount: config.PLACEMENT_BENEFITS_REMINDER_QUERY_COUNT,
      queryPlan,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting placement benefits reminder sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const placementFields = [
    "id",
    "status",
    "dateBegin",
    "employmentType",
    "candidate(id,firstName,lastName,email,customText21,owner(id,firstName,lastName,email,primaryDepartment(name)))",
    "clientCorporation(id,name)",
    "jobOrder(id,title,owner(id,firstName,lastName,email))",
  ].join(",");

  const stagePlacements = [];
  const seenKeys = new Set();

  for (const plan of queryPlan) {
    const stage = BENEFITS_REMINDER_STAGES.find((item) => item.key === plan.stageKey);

    for (const queryDateBegin of plan.dateBeginDates) {
      const window = buildUtcDayWindowFromDateKey(queryDateBegin);
      const placements = await bullhorn.queryPlacementsByDateBeginRange({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        startMs: window.startMs,
        endMs: window.endMs,
        count: config.PLACEMENT_BENEFITS_REMINDER_QUERY_COUNT,
        fieldsOverride: placementFields,
      });

      for (const placement of placements) {
        const key = `${stage.key}:${placement.id}`;
        if (seenKeys.has(key)) {
          continue;
        }

        seenKeys.add(key);
        stagePlacements.push({
          stage,
          queryDateBegin,
          placement,
        });
      }
    }
  }

  logger.info({ placementCount: stagePlacements.length }, "Fetched placements for benefits reminder query plan");

  let skippedNonMatchingPlacement = 0;
  let skippedMissingCandidateEmail = 0;
  let missingCandidateOwnerEmail = 0;
  let missingJobOrderOwnerEmail = 0;
  const placementsByStage = {
    day10: 0,
    newYorkDay10: 0,
    day21: 0,
    day26: 0,
  };
  const candidateCache = new Map();
  const ownerCache = new Map();
  const matchedPlacements = [];
  const sparkPostPayload = [];
  const transmissions = [];

  for (const item of stagePlacements) {
    const hydratedPlacement = await hydratePlacementOwners({
      bullhorn,
      session,
      placement: item.placement,
      candidateCache,
      ownerCache,
    });

    if (!matchesBenefitsReminderPlacement(hydratedPlacement)) {
      skippedNonMatchingPlacement += 1;
      continue;
    }

    const isNewYorkDay10 =
      item.stage.key === "day10" && matchesNewYorkBenefitsReminderPlacement(hydratedPlacement);
    const templateId = isNewYorkDay10 ? null : getStageTemplateId({ config, stage: item.stage });
    const transmissionPayload = isNewYorkDay10
      ? buildNewYorkBenefitsReminderTransmission({
          placement: hydratedPlacement,
        })
      : buildBenefitsReminderTransmission({
          placement: hydratedPlacement,
          stage: item.stage,
          templateId,
        });

    if (transmissionPayload.recipientEnvelope.missingCandidateEmail) {
      skippedMissingCandidateEmail += 1;
      continue;
    }

    if (transmissionPayload.recipientEnvelope.missingCandidateOwnerEmail) {
      missingCandidateOwnerEmail += 1;
    }

    if (transmissionPayload.recipientEnvelope.missingJobOrderOwnerEmail) {
      missingJobOrderOwnerEmail += 1;
    }

    const placementReportRecord = buildPlacementReportRecord({
      placement: hydratedPlacement,
      stage: isNewYorkDay10
        ? {
            ...item.stage,
            key: NEW_YORK_BENEFITS_RULE_KEY,
            label: "new-york-day-10",
          }
        : item.stage,
      templateId,
      queryDateBegin: item.queryDateBegin,
      businessDateKey,
      recipientEnvelope: transmissionPayload.recipientEnvelope,
      sparkPostPayload: isNewYorkDay10
        ? transmissionPayload
        : {
            content: {
              template_id: templateId,
              headers: transmissionPayload.headers || null,
            },
            recipients: transmissionPayload.recipients,
          },
    });

    matchedPlacements.push(placementReportRecord);
    sparkPostPayload.push(placementReportRecord.sparkPostPayload);
    if (isNewYorkDay10) {
      placementsByStage.newYorkDay10 += 1;
    } else {
      placementsByStage[item.stage.key] += 1;
    }

    if (!config.DRY_RUN) {
      const audit = {
          workflowName: "placement-benefits-reminder-sync",
          sendType: "reminder",
          ruleKey: isNewYorkDay10 ? NEW_YORK_BENEFITS_RULE_KEY : item.stage.key,
          recipientType: "candidate",
          recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
          recipientFirstName: hydratedPlacement?.candidate?.firstName || "",
          placementId: hydratedPlacement?.id || null,
          candidateId: hydratedPlacement?.candidate?.id || null,
          clientCorporationId: hydratedPlacement?.clientCorporation?.id || null,
          ownerId:
            hydratedPlacement?.candidate?.owner?.id ||
            hydratedPlacement?.jobOrder?.owner?.id ||
            null,
          ownerEmail:
            hydratedPlacement?.candidate?.owner?.email ||
            hydratedPlacement?.jobOrder?.owner?.email ||
            "",
          businessDate: businessDateKey,
          runDate: businessDateKey,
          context: {
            queryDateBegin: item.queryDateBegin,
          },
          metadata: {
            stageKey: isNewYorkDay10 ? NEW_YORK_BENEFITS_RULE_KEY : item.stage.key,
            stageLabel: isNewYorkDay10 ? "new-york-day-10" : item.stage.label,
          },
        };
      const transmission = isNewYorkDay10
        ? await sparkPost.sendInlineTransmission({
            ...transmissionPayload,
            audit,
          })
        : await sparkPost.sendTransmission({
            templateId,
            recipients: transmissionPayload.recipients,
            headers: transmissionPayload.headers,
            audit,
          });

      transmissions.push({
        placementId: hydratedPlacement.id,
        stage: isNewYorkDay10 ? "new-york-day-10" : item.stage.label,
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
      totalPlacementsQueried: stagePlacements.length,
      matchedPlacements: matchedPlacements.length,
      day10Count: placementsByStage.day10,
      newYorkDay10Count: placementsByStage.newYorkDay10,
      day21Count: placementsByStage.day21,
      day26Count: placementsByStage.day26,
      skippedNonMatchingPlacement,
      skippedMissingCandidateEmail,
      missingCandidateOwnerEmail,
      missingJobOrderOwnerEmail,
    },
    sparkPost: {
      sent: !config.DRY_RUN && matchedPlacements.length > 0,
      transmissionCount: transmissions.length,
      payloadCount: sparkPostPayload.length,
      transmissions,
      payload: sparkPostPayload,
    },
    placements: matchedPlacements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: sparkPostPayload });
  logger.info({ reportPath }, "Placement benefits reminder report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "Placement benefits reminder SparkPost payload report written",
  );

  return buildWorkflowResult({
    workflowName: "placement-benefits-reminder-sync",
    report,
    artifacts: {
      reportPath,
      sparkPostPayloadReportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Placement benefits reminder sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  writeSparkPostPayloadReport,
};
