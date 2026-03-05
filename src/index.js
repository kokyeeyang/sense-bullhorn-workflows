require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const { inferStateFromCandidate } = require("./phoneUtils");

function epochSecondsFromDate(date) {
  return Math.floor(date.getTime() / 1000);
}

async function run() {
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });

  const now = new Date();
  const from = new Date(now.getTime() - config.LOOKBACK_HOURS * 60 * 60 * 1000);
  const fromEpoch = epochSecondsFromDate(from);
  const toEpoch = epochSecondsFromDate(now);

  logger.info(
    {
      fromEpoch,
      toEpoch,
      lookbackHours: config.LOOKBACK_HOURS,
      dryRun: config.DRY_RUN,
    },
    "Starting candidate state sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const candidates = await bullhorn.searchCandidates({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    fromEpochSeconds: fromEpoch,
    toEpochSeconds: toEpoch,
  });

  logger.info({ candidateCount: candidates.length }, "Fetched candidates");

  let updated = 0;
  let skippedNoMapping = 0;
  let skippedNoChange = 0;

  for (const candidate of candidates) {
    const mapped = inferStateFromCandidate(candidate);
    if (!mapped) {
      skippedNoMapping += 1;
      continue;
    }

    const currentState = candidate.address?.state || null;
    if (currentState === mapped.state) {
      skippedNoChange += 1;
      continue;
    }

    if (config.DRY_RUN) {
      logger.info(
        {
          candidateId: candidate.id,
          oldState: currentState,
          newState: mapped.state,
          areaCode: mapped.areaCode,
          callingCode: mapped.callingCode,
          mappingType: mapped.mappingType,
        },
        "DRY_RUN: candidate state would be updated",
      );
      updated += 1;
      continue;
    }

    await bullhorn.updateCandidateState({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      candidateId: candidate.id,
      state: mapped.state,
    });

    updated += 1;
    logger.info(
      {
        candidateId: candidate.id,
        oldState: currentState,
        newState: mapped.state,
        areaCode: mapped.areaCode,
        callingCode: mapped.callingCode,
        mappingType: mapped.mappingType,
      },
      "Candidate state updated",
    );
  }

  logger.info(
    { updated, skippedNoMapping, skippedNoChange, totalCandidates: candidates.length },
    "Candidate state sync finished",
  );
}

run().catch((error) => {
  logger.error(
    {
      message: error.message,
      stack: error.stack,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    },
    "Candidate state sync failed",
  );
  process.exitCode = 1;
});
