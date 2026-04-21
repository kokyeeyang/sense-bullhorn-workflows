require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const { inferAddressUpdateFromCandidate } = require("./phoneUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("./workflowRuntime");

function epochSecondsFromDate(date) {
  return Math.floor(date.getTime() / 1000);
}

function parseIsoDateStart(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = new Date(`${normalized.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid CANDIDATE_STATE_SYNC_CUTOFF_DATE: ${value}`);
  }

  return parsed;
}

function buildCandidateDateWindow({ now, lookbackHours, cutoffDateValue }) {
  const lookbackFrom = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const cutoffDate = parseIsoDateStart(cutoffDateValue);
  const from =
    cutoffDate && cutoffDate.getTime() > lookbackFrom.getTime() ? cutoffDate : lookbackFrom;

  return {
    from,
    to: now,
    cutoffDate,
  };
}

function parseBullhornDateAdded(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 100000000000 ? value * 1000 : value;
    return milliseconds;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return null;

    if (/^\d+$/.test(normalized)) {
      const numericValue = Number(normalized);
      if (!Number.isFinite(numericValue)) return null;
      return numericValue < 100000000000 ? numericValue * 1000 : numericValue;
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.getTime();
  }

  return null;
}

function parseCandidateIds(value) {
  if (value === null || value === undefined || value === "") return [];

  const rawValues = Array.isArray(value) ? value : String(value).split(",");
  const seen = new Set();
  const candidateIds = [];

  for (const rawValue of rawValues) {
    const normalized = String(rawValue || "").trim();
    if (!normalized) continue;
    if (!/^\d+$/.test(normalized)) {
      throw new Error(`Invalid candidateIds value: ${rawValue}`);
    }

    const candidateId = Number(normalized);
    if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
      throw new Error(`Invalid candidateIds value: ${rawValue}`);
    }

    if (!seen.has(candidateId)) {
      seen.add(candidateId);
      candidateIds.push(candidateId);
    }
  }

  return candidateIds;
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
  return writeJsonArtifact({ filePrefix: "changes-report", payload: report });
}

async function run({ candidateIds = null } = {}) {
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });
  const explicitCandidateIds = parseCandidateIds(candidateIds);

  const now = new Date();
  const dateWindow = buildCandidateDateWindow({
    now,
    lookbackHours: config.LOOKBACK_HOURS,
    cutoffDateValue: config.CANDIDATE_STATE_SYNC_CUTOFF_DATE,
  });
  const { from, to, cutoffDate } = dateWindow;
  const fromEpoch = epochSecondsFromDate(from);
  const toEpoch = epochSecondsFromDate(to);
  const cutoffMs = cutoffDate?.getTime() ?? null;

  logger.info(
    {
      fromEpoch,
      toEpoch,
      lookbackHours: config.LOOKBACK_HOURS,
      candidateStateSyncCutoffDate: config.CANDIDATE_STATE_SYNC_CUTOFF_DATE,
      dryRun: config.DRY_RUN,
      testCandidateId: config.TEST_CANDIDATE_ID || null,
      explicitCandidateCount: explicitCandidateIds.length,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
      updateDelayMs: config.UPDATE_DELAY_MS,
    },
    "Starting candidate state sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const candidateIdsToFetch = config.TEST_CANDIDATE_ID
    ? [config.TEST_CANDIDATE_ID]
    : explicitCandidateIds;

  let candidates;
  if (candidateIdsToFetch.length > 0) {
    candidates = [];
    for (const candidateId of candidateIdsToFetch) {
      const fetchedCandidates = await bullhorn.searchCandidates({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        fromEpochSeconds: fromEpoch,
        toEpochSeconds: toEpoch,
        candidateId,
      });
      candidates.push(...fetchedCandidates);
    }
  } else {
    candidates = await bullhorn.searchCandidates({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      fromEpochSeconds: fromEpoch,
      toEpochSeconds: toEpoch,
    });
  }

  logger.info({ candidateCount: candidates.length }, "Fetched candidates");

  let updated = 0;
  let skippedBeforeCutoff = 0;
  let skippedOutsideLookback = 0;
  let skippedNoMapping = 0;
  let skippedNoChange = 0;
  const affectedCandidates = [];
  const skippedBeforeCutoffSamples = [];
  const skippedOutsideLookbackSamples = [];

  for (const candidate of candidates) {
    const candidateDateAddedMs = parseBullhornDateAdded(candidate.dateAdded);
    if (
      cutoffMs !== null &&
      (!Number.isFinite(candidateDateAddedMs) || candidateDateAddedMs < cutoffMs)
    ) {
      if (skippedBeforeCutoffSamples.length < 10) {
        skippedBeforeCutoffSamples.push({
          candidateId: candidate.id,
          rawDateAdded: candidate.dateAdded ?? null,
          rawDateAddedType: candidate.dateAdded === null ? "null" : typeof candidate.dateAdded,
          parsedDateAdded:
            Number.isFinite(candidateDateAddedMs)
              ? new Date(candidateDateAddedMs).toISOString()
              : null,
        });
      }
      skippedBeforeCutoff += 1;
      continue;
    }

    if (
      !Number.isFinite(candidateDateAddedMs) ||
      candidateDateAddedMs < from.getTime() ||
      candidateDateAddedMs > to.getTime()
    ) {
      if (skippedOutsideLookbackSamples.length < 10) {
        skippedOutsideLookbackSamples.push({
          candidateId: candidate.id,
          rawDateAdded: candidate.dateAdded ?? null,
          rawDateAddedType: candidate.dateAdded === null ? "null" : typeof candidate.dateAdded,
          parsedDateAdded:
            Number.isFinite(candidateDateAddedMs)
              ? new Date(candidateDateAddedMs).toISOString()
              : null,
        });
      }
      skippedOutsideLookback += 1;
      continue;
    }

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
    {
      updated,
      skippedBeforeCutoff,
      skippedOutsideLookback,
      skippedNoMapping,
      skippedNoChange,
      totalCandidates: candidates.length,
    },
    "Candidate state sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    testCandidateId: config.TEST_CANDIDATE_ID || null,
    candidateIds: explicitCandidateIds,
    window: {
      fromEpoch,
      toEpoch,
      lookbackHours: config.LOOKBACK_HOURS,
      cutoffDate: config.CANDIDATE_STATE_SYNC_CUTOFF_DATE,
    },
    totals: {
      totalCandidates: candidates.length,
      affectedCandidates: affectedCandidates.length,
      updated,
      skippedBeforeCutoff,
      skippedOutsideLookback,
      skippedNoMapping,
      skippedNoChange,
    },
    affectedCandidates,
    diagnostics: {
      skippedBeforeCutoffSamples,
      skippedOutsideLookbackSamples,
    },
  };

  const reportPath = await writeChangesReport({ report });
  logger.info({ reportPath }, "Changes report written");

  return buildWorkflowResult({
    workflowName: "candidate-state-sync",
    report,
    artifacts: {
      reportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Candidate state sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  buildCandidateDateWindow,
  parseCandidateIds,
  parseBullhornDateAdded,
  parseIsoDateStart,
  run,
};
