require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const { inferAddressUpdateFromCandidate } = require("./phoneUtils");

function epochSecondsFromDate(date) {
  return Math.floor(date.getTime() / 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAddressChanges(currentAddress, addressPatch) {
  const changes = [];
  for (const [field, newValue] of Object.entries(addressPatch)) {
    const oldValue = currentAddress?.[field] ?? null;
    if (oldValue !== newValue) {
      changes.push({ field, oldValue, newValue });
    }
  }
  return changes;
}

async function writeChangesReport({ report }) {
  const reportsDir = path.resolve(process.cwd(), "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `changes-report-${timestamp}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return reportPath;
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
      testCandidateId: config.TEST_CANDIDATE_ID || null,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
      updateDelayMs: config.UPDATE_DELAY_MS,
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
    candidateId: config.TEST_CANDIDATE_ID,
  });

  logger.info({ candidateCount: candidates.length }, "Fetched candidates");

  let updated = 0;
  let skippedNoMapping = 0;
  let skippedNoChange = 0;
  const affectedCandidates = [];

  for (const candidate of candidates) {
    const mapped = inferAddressUpdateFromCandidate(candidate);
    if (!mapped) {
      if (config.DRY_RUN) {
        logger.info(
          {
            candidateId: candidate.id,
            phone: candidate.phone || null,
            mobile: candidate.mobile || null,
            phone2: candidate.phone2 || null,
            phone3: candidate.phone3 || null,
            candidate,
          },
          "DRY_RUN: no mapping found for candidate",
        );
      }
      skippedNoMapping += 1;
      continue;
    }

    const changes = getAddressChanges(candidate.address, mapped.addressPatch);
    if (changes.length === 0) {
      skippedNoChange += 1;
      continue;
    }

    const candidatePreview = {
      ...candidate,
      address: {
        ...(candidate.address || {}),
        ...mapped.addressPatch,
      },
    };

    if (config.DRY_RUN) {
      affectedCandidates.push({
        candidateId: candidate.id,
        mode: "dry-run",
        mappingType: mapped.mappingType,
        areaCode: mapped.areaCode || null,
        callingCode: mapped.callingCode || null,
        changes,
      });

      logger.info(
        {
          candidateId: candidate.id,
          changes,
          areaCode: mapped.areaCode,
          callingCode: mapped.callingCode,
          mappingType: mapped.mappingType,
          candidatePreview,
        },
        "DRY_RUN: candidate would be updated",
      );
      updated += 1;
      continue;
    }

    await bullhorn.updateCandidateAddress({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      candidateId: candidate.id,
      addressPatch: mapped.addressPatch,
    });

    affectedCandidates.push({
      candidateId: candidate.id,
      mode: "updated",
      mappingType: mapped.mappingType,
      areaCode: mapped.areaCode || null,
      callingCode: mapped.callingCode || null,
      changes,
    });

    updated += 1;
    logger.info(
      {
        candidateId: candidate.id,
        changes,
        areaCode: mapped.areaCode,
        callingCode: mapped.callingCode,
        mappingType: mapped.mappingType,
      },
      "Candidate updated",
    );

    if (config.UPDATE_DELAY_MS > 0) {
      await sleep(config.UPDATE_DELAY_MS);
    }
  }

  logger.info(
    { updated, skippedNoMapping, skippedNoChange, totalCandidates: candidates.length },
    "Candidate state sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    testCandidateId: config.TEST_CANDIDATE_ID || null,
    window: {
      fromEpoch,
      toEpoch,
      lookbackHours: config.LOOKBACK_HOURS,
    },
    totals: {
      totalCandidates: candidates.length,
      affectedCandidates: affectedCandidates.length,
      updated,
      skippedNoMapping,
      skippedNoChange,
    },
    affectedCandidates,
  };

  const reportPath = await writeChangesReport({ report });
  logger.info({ reportPath }, "Changes report written");
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
