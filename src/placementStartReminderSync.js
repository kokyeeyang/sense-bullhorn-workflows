require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");

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

async function run() {
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });
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
  const placementsWithOwners = [];
  const recipientMap = new Map();
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

    const reminderItem = {
      placementId: placement.id,
      dateBegin: placement.dateBegin,
      candidate: {
        id: candidate.id,
        firstName: candidate.firstName || null,
        lastName: candidate.lastName || null,
        email: candidate.email || null,
        dateAdded: candidate.dateAdded || null,
      },
      clientCorporation: {
        id: placement?.clientCorporation?.id || null,
        name: placement?.clientCorporation?.name || null,
      },
      owner: {
        id: owner.id,
        firstName: owner.firstName || null,
        lastName: owner.lastName || null,
        email: owner.email,
      },
    };

    placementsWithOwners.push(reminderItem);

    if (!recipientMap.has(owner.email)) {
      recipientMap.set(owner.email, {
        owner: reminderItem.owner,
        placements: [],
      });
    }

    recipientMap.get(owner.email).placements.push({
      placementId: reminderItem.placementId,
      dateBegin: reminderItem.dateBegin,
      candidate: reminderItem.candidate,
      clientCorporation: reminderItem.clientCorporation,
    });
  }

  const recipients = Array.from(recipientMap.values()).map((entry) => ({
    owner: entry.owner,
    placementCount: entry.placements.length,
    placements: entry.placements,
  }));

  logger.info(
    {
      placementCount: placements.length,
      matchedPlacements: placementsWithOwners.length,
      recipientCount: recipients.length,
      skippedMissingCandidateId,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
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
      matchedPlacements: placementsWithOwners.length,
      recipients: recipients.length,
      skippedMissingCandidateId,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
    },
    recipients,
    placementsWithOwners,
  };

  const reportPath = await writeChangesReport({ report });
  logger.info({ reportPath }, "Placement start reminder report written");

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

module.exports = { buildUtcDayWindow, run };
