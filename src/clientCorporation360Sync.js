require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const {
  getClientCorporationChanges,
  hasClientCorporationDelayPassed,
  inferClientCorporation360Patch,
  isExcludedClientCorporationName,
} = require("./clientCorporation360Utils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("./workflowRuntime");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsedMs(startTime) {
  return Date.now() - startTime;
}

function epochSecondsFromDateString(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid CLIENT_CORPORATION_360_CUTOFF_DATE: ${value}`);
  }

  return Math.floor(date.getTime() / 1000);
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "client-corporation-360-report", payload: report });
}

async function run() {
  const startedAtMs = Date.now();
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });
  const fromEpoch = epochSecondsFromDateString(config.CLIENT_CORPORATION_360_CUTOFF_DATE);

  logger.info(
    {
      cutoffDate: config.CLIENT_CORPORATION_360_CUTOFF_DATE,
      delayHours: config.CLIENT_CORPORATION_360_DELAY_HOURS,
      fromEpoch,
      dryRun: config.DRY_RUN,
      testClientCorporationId: config.TEST_CLIENT_CORPORATION_ID || null,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
      updateDelayMs: config.UPDATE_DELAY_MS,
    },
    "Starting client corporation 360 cleanup",
  );

  logger.info({ elapsedMs: elapsedMs(startedAtMs) }, "Starting Bullhorn authorization");
  const code = await bullhorn.getAuthorizationCode();
  logger.info({ elapsedMs: elapsedMs(startedAtMs) }, "Bullhorn authorization code acquired");
  const accessToken = await bullhorn.getAccessToken(code);
  logger.info({ elapsedMs: elapsedMs(startedAtMs) }, "Bullhorn access token acquired");
  const session = await bullhorn.login(accessToken);
  logger.info({ elapsedMs: elapsedMs(startedAtMs), restUrl: session.restUrl }, "Bullhorn login completed");

  logger.info(
    {
      elapsedMs: elapsedMs(startedAtMs),
      mode: config.TEST_CLIENT_CORPORATION_ID ? "test-client-corporation" : "cutoff-date-search",
      cutoffDate: config.CLIENT_CORPORATION_360_CUTOFF_DATE,
      fromEpoch,
      testClientCorporationId: config.TEST_CLIENT_CORPORATION_ID || null,
    },
    "Starting client corporation load",
  );
  const clientCorporations = await bullhorn.searchClientCorporations({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    fromEpochSeconds: fromEpoch,
    clientCorporationId: config.TEST_CLIENT_CORPORATION_ID,
  });
  logger.info(
    {
      elapsedMs: elapsedMs(startedAtMs),
      clientCorporationCount: clientCorporations.length,
    },
    "Finished client corporation load",
  );

  logger.info({ clientCorporationCount: clientCorporations.length }, "Fetched client corporations");

  let updated = 0;
  let skippedExcludedName = 0;
  let skippedDelayNotMet = 0;
  let skippedNoPatch = 0;
  let skippedNoChange = 0;
  const affectedClientCorporations = [];
  let inspectedClientCorporations = 0;

  for (const clientCorporation of clientCorporations) {
    inspectedClientCorporations += 1;
    if (isExcludedClientCorporationName(clientCorporation.name)) {
      skippedExcludedName += 1;
      continue;
    }

    const patch = inferClientCorporation360Patch(clientCorporation, {
      delayHours: config.CLIENT_CORPORATION_360_DELAY_HOURS,
    });
    if (!patch) {
      if (
        !clientCorporation.customText7 &&
        !hasClientCorporationDelayPassed(
          clientCorporation,
          config.CLIENT_CORPORATION_360_DELAY_HOURS,
        )
      ) {
        skippedDelayNotMet += 1;
      } else {
        skippedNoPatch += 1;
      }
      continue;
    }

    const changes = getClientCorporationChanges(clientCorporation, patch);
    if (changes.length === 0) {
      skippedNoChange += 1;
      continue;
    }

    if (config.DRY_RUN) {
      affectedClientCorporations.push({
        clientCorporationId: clientCorporation.id,
        mode: "dry-run",
        changes,
      });

      logger.info(
        {
          clientCorporationId: clientCorporation.id,
          clientCorporationName: clientCorporation.name,
          changes,
          patch,
        },
        "DRY_RUN: client corporation would be updated",
      );

      updated += 1;
      continue;
    }

    await bullhorn.updateClientCorporation({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      clientCorporationId: clientCorporation.id,
      patch,
    });

    affectedClientCorporations.push({
      clientCorporationId: clientCorporation.id,
      mode: "updated",
      changes,
    });

    updated += 1;
    logger.info(
      {
        clientCorporationId: clientCorporation.id,
        clientCorporationName: clientCorporation.name,
        changes,
      },
      "Client corporation updated",
    );

    if (config.UPDATE_DELAY_MS > 0) {
      await sleep(config.UPDATE_DELAY_MS);
    }

    if (inspectedClientCorporations % 100 === 0) {
      logger.info(
        {
          elapsedMs: elapsedMs(startedAtMs),
          inspectedClientCorporations,
          updated,
          skippedExcludedName,
          skippedDelayNotMet,
          skippedNoPatch,
          skippedNoChange,
        },
        "Client corporation 360 cleanup progress",
      );
    }
  }

  logger.info(
    {
      elapsedMs: elapsedMs(startedAtMs),
      updated,
      skippedExcludedName,
      skippedDelayNotMet,
      skippedNoPatch,
      skippedNoChange,
      totalClientCorporations: clientCorporations.length,
    },
    "Client corporation 360 cleanup finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    testClientCorporationId: config.TEST_CLIENT_CORPORATION_ID || null,
    window: {
      cutoffDate: config.CLIENT_CORPORATION_360_CUTOFF_DATE,
      fromEpoch,
    },
    totals: {
      totalClientCorporations: clientCorporations.length,
      affectedClientCorporations: affectedClientCorporations.length,
      updated,
      skippedExcludedName,
      skippedDelayNotMet,
      skippedNoPatch,
      skippedNoChange,
    },
    affectedClientCorporations,
  };

  const reportPath = await writeChangesReport({ report });
  logger.info({ reportPath }, "Client corporation changes report written");

  return buildWorkflowResult({
    workflowName: "client-corporation-360-sync",
    report,
    artifacts: {
      reportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Client corporation 360 cleanup failed");
    process.exitCode = 1;
  });
}

module.exports = { epochSecondsFromDateString, run };
