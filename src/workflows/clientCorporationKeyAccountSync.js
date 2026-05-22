require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const {
  writeWorkflowDataMutationAuditRecordsSafe,
} = require("../stores/postgresWorkflowDataMutationAuditStore");
const {
  getClientCorporationChanges,
  hasClientCorporationDelayPassed,
  inferClientCorporationKeyAccountPatch,
  isListedClientCorporationName,
} = require("../utils/clientCorporationKeyAccountUtils");
const { calculateRollingFromEpoch, epochSecondsFromDateString } = require("./clientCorporation360Sync");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "client-corporation-key-account-report",
    payload: report,
  });
}

async function run() {
  const nowMs = Date.now();
  const config = loadConfig("client-corporation-key-account-sync");
  const bullhorn = new BullhornClient({ config, logger });
  const cutoffEpoch = epochSecondsFromDateString(config.CLIENT_CORPORATION_KEY_ACCOUNT_CUTOFF_DATE);
  const fromEpoch = calculateRollingFromEpoch({
    cutoffDate: config.CLIENT_CORPORATION_KEY_ACCOUNT_CUTOFF_DATE,
    windowDays: config.CLIENT_CORPORATION_KEY_ACCOUNT_WINDOW_DAYS,
    nowMs,
  });
  const eligibleThroughEpoch = Math.floor(
    (nowMs - config.CLIENT_CORPORATION_KEY_ACCOUNT_DELAY_HOURS * 60 * 60 * 1000) / 1000,
  );

  logger.info(
    {
      cutoffDate: config.CLIENT_CORPORATION_KEY_ACCOUNT_CUTOFF_DATE,
      cutoffEpoch,
      delayHours: config.CLIENT_CORPORATION_KEY_ACCOUNT_DELAY_HOURS,
      windowDays: config.CLIENT_CORPORATION_KEY_ACCOUNT_WINDOW_DAYS,
      fromEpoch,
      eligibleThroughEpoch,
      queryCount: config.CLIENT_CORPORATION_KEY_ACCOUNT_QUERY_COUNT,
      dryRun: config.DRY_RUN,
      testClientCorporationId: config.TEST_CLIENT_CORPORATION_ID || null,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
      updateDelayMs: config.UPDATE_DELAY_MS,
    },
    "Starting client corporation key account cleanup",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const clientCorporations = await bullhorn.searchClientCorporations({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    fromEpochSeconds: fromEpoch,
    toEpochSeconds: config.TEST_CLIENT_CORPORATION_ID ? undefined : eligibleThroughEpoch,
    clientCorporationId: config.TEST_CLIENT_CORPORATION_ID,
    maxCount: config.TEST_CLIENT_CORPORATION_ID ? 1 : config.CLIENT_CORPORATION_KEY_ACCOUNT_QUERY_COUNT,
  });

  logger.info({ clientCorporationCount: clientCorporations.length }, "Fetched client corporations");

  let updated = 0;
  let skippedNameNotListed = 0;
  let skippedDelayNotMet = 0;
  let skippedNoPatch = 0;
  let skippedNoChange = 0;
  const affectedClientCorporations = [];

  for (const clientCorporation of clientCorporations) {
    if (!isListedClientCorporationName(clientCorporation.name)) {
      skippedNameNotListed += 1;
      continue;
    }

    const patch = inferClientCorporationKeyAccountPatch(clientCorporation, {
      delayHours: config.CLIENT_CORPORATION_KEY_ACCOUNT_DELAY_HOURS,
    });

    if (!patch) {
      if (
        !clientCorporation.customText7 &&
        !hasClientCorporationDelayPassed(
          clientCorporation,
          config.CLIENT_CORPORATION_KEY_ACCOUNT_DELAY_HOURS,
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
        "DRY_RUN: client corporation would be updated to Key Account",
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
      "Client corporation updated to Key Account",
    );

    if (config.UPDATE_DELAY_MS > 0) {
      await sleep(config.UPDATE_DELAY_MS);
    }
  }

  logger.info(
    {
      updated,
      skippedNameNotListed,
      skippedDelayNotMet,
      skippedNoPatch,
      skippedNoChange,
      totalClientCorporations: clientCorporations.length,
    },
    "Client corporation key account cleanup finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    testClientCorporationId: config.TEST_CLIENT_CORPORATION_ID || null,
    window: {
      cutoffDate: config.CLIENT_CORPORATION_KEY_ACCOUNT_CUTOFF_DATE,
      cutoffEpoch,
      windowDays: config.CLIENT_CORPORATION_KEY_ACCOUNT_WINDOW_DAYS,
      fromEpoch,
      eligibleThroughEpoch,
    },
    totals: {
      totalClientCorporations: clientCorporations.length,
      affectedClientCorporations: affectedClientCorporations.length,
      updated,
      skippedNameNotListed,
      skippedDelayNotMet,
      skippedNoPatch,
      skippedNoChange,
    },
    affectedClientCorporations,
  };

  report.dataMutationAudit = await writeWorkflowDataMutationAuditRecordsSafe({
    config,
    logger,
    workflowName: "client-corporation-key-account-sync",
    report,
  });

  const reportPath = await writeChangesReport({ report });
  logger.info({ reportPath }, "Client corporation key account changes report written");

  return buildWorkflowResult({
    workflowName: "client-corporation-key-account-sync",
    report,
    artifacts: {
      reportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Client corporation key account cleanup failed");
    process.exitCode = 1;
  });
}

module.exports = { run };
