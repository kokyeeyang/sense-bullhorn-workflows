require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  QUERY_COUNT_DEFAULT,
  SEND_AT_PACIFIC_HOUR,
  WORKFLOW_NAME,
  buildReportRecord,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  matchesPlacement,
} = require("../utils/payrollNewHireGreetingUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");

const PLACEMENT_FIELDS = [
  "id",
  "status",
  "dateBegin",
  "dateEnd",
  "employmentType",
  "candidate(id,firstName,lastName,email,address(countryName))",
  "clientCorporation(id,name)",
  "jobOrder(id,title,employmentType,address(countryName,state),owner(id,firstName,lastName,email))",
].join(",");

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) return;
  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "payroll-new-hire-greeting-report", payload: report });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "payroll-new-hire-greeting-sparkpost-payload",
    payload,
  });
}

async function run({ targetDate } = {}) {
  const config = loadConfig("payroll-new-hire-greeting-sync");
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const business = getBusinessDateParts();
  const configuredTargetDate = config.PAYROLL_NEW_HIRE_GREETING_TARGET_DATE || null;
  const businessDateKey = targetDate || configuredTargetDate || business.dateKey;
  const forceTimedRun = Boolean(targetDate || configuredTargetDate);

  if (!forceTimedRun && business.hour !== SEND_AT_PACIFIC_HOUR) {
    const report = {
      generatedAt: new Date().toISOString(),
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      expectedPacificHour: SEND_AT_PACIFIC_HOUR,
      skippedReason: "outside-send-hour",
      totals: {
        totalPlacementsQueried: 0,
        matchedPlacements: 0,
        skippedNonMatchingPlacement: 0,
        skippedMissingToEmail: 0,
        skippedAlreadySent: 0,
        sendLockUnavailable: 0,
      },
      sparkPost: { sent: false, transmissionCount: 0, payloadCount: 0, transmissions: [], payload: [] },
      placements: [],
    };
    const reportPath = await writeChangesReport({ report });
    const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({ payload: [] });
    return buildWorkflowResult({
      workflowName: WORKFLOW_NAME,
      report,
      artifacts: { reportPath, sparkPostPayloadReportPath },
    });
  }

  logger.info(
    {
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      businessHour: business.hour,
      queryCount: config.PAYROLL_NEW_HIRE_GREETING_QUERY_COUNT || QUERY_COUNT_DEFAULT,
    },
    "Starting payroll new hire greeting sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const window = buildUtcDayWindowFromDateKey(businessDateKey);
  const placements = await bullhorn.queryPlacementsByDateBeginRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: window.startMs,
    endMs: window.endMs,
    count: config.PAYROLL_NEW_HIRE_GREETING_QUERY_COUNT || QUERY_COUNT_DEFAULT,
    fieldsOverride: PLACEMENT_FIELDS,
  });

  const matchedPlacements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedNonMatchingPlacement = 0;
  let skippedMissingToEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const placement of placements) {
    if (!matchesPlacement(placement)) {
      skippedNonMatchingPlacement += 1;
      continue;
    }

    const transmissionPayload = buildTransmission({ placement });
    if (transmissionPayload.recipientEnvelope.missingToEmail) {
      skippedMissingToEmail += 1;
      continue;
    }

    const entityId = `${placement.id}|${businessDateKey}`;
    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement",
        entityId,
        metadata: { businessDate: businessDateKey, placementId: placement.id },
      });
      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        continue;
      }
      if (sendLock.skipped) sendLockUnavailable += 1;
    }

    const record = buildReportRecord({
      placement,
      businessDateKey,
      queryDate: businessDateKey,
      transmission: transmissionPayload,
    });
    matchedPlacements.push({ ...record, sendLock });
    sparkPostPayload.push(record.sparkPostPayload);

    if (!config.DRY_RUN) {
      try {
        const transmission = await sparkPost.sendInlineTransmission({
          ...transmissionPayload,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "notification",
            ruleKey: "date-begin-payroll-greeting",
            recipientType: "candidate",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail || "",
            recipientFirstName: placement?.candidate?.firstName || "",
            placementId: placement?.id || null,
            candidateId: placement?.candidate?.id || null,
            clientCorporationId: placement?.clientCorporation?.id || null,
            businessDate: businessDateKey,
            runDate: businessDateKey,
          },
        });
        transmissions.push({ placementId: placement.id, transmission });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({
            config,
            workflowName: WORKFLOW_NAME,
            entityType: "placement",
            entityId,
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
    totals: {
      totalPlacementsQueried: placements.length,
      matchedPlacements: matchedPlacements.length,
      skippedNonMatchingPlacement,
      skippedMissingToEmail,
      skippedAlreadySent,
      sendLockUnavailable,
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

  return buildWorkflowResult({
    workflowName: WORKFLOW_NAME,
    report,
    artifacts: { reportPath, sparkPostPayloadReportPath },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Payroll new hire greeting sync failed");
    process.exitCode = 1;
  });
}

module.exports = { PLACEMENT_FIELDS, run };
