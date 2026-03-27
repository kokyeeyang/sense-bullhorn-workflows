require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const { SparkPostClient } = require("./sparkPostClient");
const { buildSparkPostRecipient } = require("./placementStartReminderUtils");

function buildUtcDayWindow({
  baseDate = new Date(),
  daysAhead = 4,
  windowBeforeDays = 0,
  windowAfterDays = 0,
} = {}) {
  const targetDayStart = Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate() + daysAhead,
    0,
    0,
    0,
    0,
  );

  return {
    startMs: targetDayStart - windowBeforeDays * 24 * 60 * 60 * 1000,
    endMs: targetDayStart + (windowAfterDays + 1) * 24 * 60 * 60 * 1000,
    targetDate: new Date(targetDayStart).toISOString().slice(0, 10),
    windowBeforeDays,
    windowAfterDays,
  };
}

async function writeChangesReport({ report }) {
  const reportsDir = path.resolve(process.cwd(), "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `placement-start-reminder-report-${timestamp}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return reportPath;
}

async function writeSparkPostPayloadReport({ payload }) {
  const reportsDir = path.resolve(process.cwd(), "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    reportsDir,
    `placement-start-reminder-sparkpost-payload-${timestamp}.json`,
  );
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return reportPath;
}

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY");
  if (!config.SPARKPOST_TEMPLATE_ID) missing.push("SPARKPOST_TEMPLATE_ID");

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function run() {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const window = buildUtcDayWindow({
    daysAhead: config.PLACEMENT_START_REMINDER_DAYS_AHEAD,
    windowBeforeDays: config.PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS,
    windowAfterDays: config.PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS,
  });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      daysAhead: config.PLACEMENT_START_REMINDER_DAYS_AHEAD,
      windowBeforeDays: config.PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS,
      windowAfterDays: config.PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS,
      targetDate: window.targetDate,
      startMs: window.startMs,
      endMs: window.endMs,
      queryCount: config.PLACEMENT_START_REMINDER_QUERY_COUNT,
      sparkPostTemplateId: config.SPARKPOST_TEMPLATE_ID || null,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting placement start reminder sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const placements = await bullhorn.queryPlacementsByDateBeginRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: window.startMs,
    endMs: window.endMs,
    count: config.PLACEMENT_START_REMINDER_QUERY_COUNT,
  });

  logger.info({ placementCount: placements.length }, "Fetched placements for reminder window");

  let skippedMissingCandidateId = 0;
  let skippedMissingOwnerId = 0;
  let skippedMissingOwnerEmail = 0;
  const transformedPlacements = [];
  const sparkPostRecipients = [];
  const candidateCache = new Map();
  const ownerCache = new Map();

  for (const placement of placements) {
    const candidateId = placement?.candidate?.id || null;
    if (!candidateId) {
      skippedMissingCandidateId += 1;
      continue;
    }

    let candidate = candidateCache.get(candidateId);
    if (!candidate) {
      candidate = await bullhorn.getCandidate({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        candidateId,
      });
      candidateCache.set(candidateId, candidate);
    }

    const ownerId = candidate?.owner?.id || null;
    if (!ownerId) {
      skippedMissingOwnerId += 1;
      continue;
    }

    let owner = ownerCache.get(ownerId);
    if (!owner) {
      owner = await bullhorn.getCorporateUser({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        corporateUserId: ownerId,
      });
      ownerCache.set(ownerId, owner);
    }

    if (!owner?.email) {
      skippedMissingOwnerEmail += 1;
      continue;
    }

    const sparkPostRecipient = buildSparkPostRecipient({
      placement,
      recipientEmail: owner.email,
    });

    const reminderItem = {
      placementId: placement.id,
      dateBegin: placement.dateBegin,
      owner: {
        id: owner.id,
        firstName: owner.firstName || null,
        lastName: owner.lastName || null,
        email: owner.email,
      },
      sparkPostRecipient,
      placement: {
        id: placement.id,
        dateBegin: placement.dateBegin,
        candidate: {
          id: placement?.candidate?.id || candidate.id,
          firstName: placement?.candidate?.firstName || candidate.firstName || null,
          lastName: placement?.candidate?.lastName || candidate.lastName || null,
          email: candidate.email || null,
          dateAdded: candidate.dateAdded || null,
        },
        clientCorporation: {
          id: placement?.clientCorporation?.id || null,
          name: placement?.clientCorporation?.name || null,
          customText10: placement?.clientCorporation?.customText10 || null,
          customText2: placement?.clientCorporation?.customText2 || null,
          customText11: placement?.clientCorporation?.customText11 || null,
        },
        customText8: placement?.customText8 || null,
        customText18: placement?.customText18 || null,
        customText60: placement?.customText60 || null,
        billingClientContact: {
          id: placement?.billingClientContact?.id || null,
          firstName: placement?.billingClientContact?.firstName || null,
          lastName: placement?.billingClientContact?.lastName || null,
          customText3: placement?.billingClientContact?.customText3 || null,
          address: placement?.billingClientContact?.address || null,
        },
        jobOrder: {
          id: placement?.jobOrder?.id || null,
          owner: placement?.jobOrder?.owner || null,
        },
      },
    };

    transformedPlacements.push(reminderItem);
    sparkPostRecipients.push(sparkPostRecipient);
  }

  let transmission = null;
  const sparkPostPayload = {
    content: {
      template_id: config.SPARKPOST_TEMPLATE_ID || null,
    },
    recipients: sparkPostRecipients,
  };

  if (!config.DRY_RUN && sparkPostRecipients.length > 0) {
    transmission = await sparkPost.sendTransmission({
      templateId: config.SPARKPOST_TEMPLATE_ID,
      recipients: sparkPostRecipients,
    });
  }

  logger.info(
    {
      placementCount: placements.length,
      matchedPlacements: transformedPlacements.length,
      recipientCount: sparkPostRecipients.length,
      skippedMissingCandidateId,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
      sparkPostSent: !config.DRY_RUN && sparkPostRecipients.length > 0,
    },
    "Placement start reminder sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    window: {
      daysAhead: config.PLACEMENT_START_REMINDER_DAYS_AHEAD,
      windowBeforeDays: config.PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS,
      windowAfterDays: config.PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS,
      targetDate: window.targetDate,
      startMs: window.startMs,
      endMs: window.endMs,
    },
    totals: {
      totalPlacements: placements.length,
      matchedPlacements: transformedPlacements.length,
      recipients: sparkPostRecipients.length,
      skippedMissingCandidateId,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
    },
    sparkPost: {
      templateId: config.SPARKPOST_TEMPLATE_ID || null,
      recipientCount: sparkPostRecipients.length,
      sent: !config.DRY_RUN && sparkPostRecipients.length > 0,
      transmission,
      payload: sparkPostPayload,
    },
    recipients: sparkPostRecipients,
    placements: transformedPlacements,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({
    payload: sparkPostPayload,
  });
  logger.info({ reportPath }, "Placement start reminder report written");
  logger.info({ sparkPostPayloadReportPath }, "Placement start reminder SparkPost payload report written");

  return report;
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(
      {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseData: error.response?.data,
      },
      "Placement start reminder sync failed",
    );
    process.exitCode = 1;
  });
}

module.exports = { buildUtcDayWindow, run, writeSparkPostPayloadReport };
