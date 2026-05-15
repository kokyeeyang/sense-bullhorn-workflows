require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { releaseWorkflowSend, reserveWorkflowSend } = require("../stores/workflowSendLockStore");
const {
  DEFAULT_LAST_NOTE_ACTION_TYPE_FIELD,
  DEFAULT_LAST_NOTE_DATE_FIELD,
  WORKFLOW_NAME,
  buildLastContactQueryDates,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isTimedRuleDue,
  matchesPlacement,
} = require("../utils/contractorNotContactedReminderUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

function buildCandidateFields({ dateField, actionTypeField }) {
  return Array.from(new Set(["id", "firstName", "lastName", "name", "email", dateField, actionTypeField].filter(Boolean))).join(",");
}

function buildPlacementFields({ dateField, actionTypeField }) {
  return [
    "id",
    "status",
    "employmentType",
    "address(countryName)",
    `candidate(${buildCandidateFields({ dateField, actionTypeField })})`,
    "clientCorporation(id,name,address(countryName))",
    "jobOrder(id,title,employmentType,address(countryName),owner(id,firstName,lastName,email,pager))",
  ].join(",");
}

async function run({ targetDate } = {}) {
  const config = loadConfig();
  if (!config.DRY_RUN && !config.SPARKPOST_API_KEY) {
    throw new Error("Missing required SparkPost config: SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  }
  const dateField = config.CONTRACTOR_NOT_CONTACTED_LAST_NOTE_DATE_FIELD || DEFAULT_LAST_NOTE_DATE_FIELD;
  const actionTypeField = config.CONTRACTOR_NOT_CONTACTED_LAST_NOTE_ACTION_TYPE_FIELD || DEFAULT_LAST_NOTE_ACTION_TYPE_FIELD;
  const business = getBusinessDateParts();
  const businessDateKey = targetDate || config.CONTRACTOR_NOT_CONTACTED_TARGET_DATE || business.dateKey;
  const force = Boolean(targetDate || config.CONTRACTOR_NOT_CONTACTED_TARGET_DATE);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });

  if (!isTimedRuleDue({ businessHour: business.hour, dayOfWeek: business.dayOfWeek, force })) {
    const report = {
      generatedAt: new Date().toISOString(),
      dryRun: config.DRY_RUN,
      businessDate: businessDateKey,
      skippedReason: business.dayOfWeek === 0 || business.dayOfWeek === 6 ? "outside-pacific-weekday" : "outside-send-hour",
      fieldMapping: { dateField, actionTypeField },
      totals: { totalCandidatesQueried: 0, totalPlacementsQueried: 0, matchedPlacements: 0 },
      sparkPost: { sent: false, transmissionCount: 0, payloadCount: 0, transmissions: [], payload: [] },
      placements: [],
      skippedPlacements: [],
    };
    const reportPath = await writeJsonArtifact({ filePrefix: "contractor-not-contacted-reminder-report", payload: report });
    const sparkPostPayloadReportPath = await writeJsonArtifact({ filePrefix: "contractor-not-contacted-reminder-sparkpost-payload", payload: [] });
    return buildWorkflowResult({ workflowName: WORKFLOW_NAME, report, artifacts: { reportPath, sparkPostPayloadReportPath } });
  }

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const queryDates = force ? [businessDateKey] : buildLastContactQueryDates({ businessDateKey });
  const candidateFields = buildCandidateFields({ dateField, actionTypeField });
  const placementFields = buildPlacementFields({ dateField, actionTypeField });
  const candidateItems = [];
  const seenCandidateIds = new Set();

  for (const queryDate of queryDates) {
    const window = buildUtcDayWindowFromDateKey(queryDate);
    const candidates = await bullhorn.queryCandidatesByDateFieldRange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      fieldName: dateField,
      startMs: window.startMs,
      endMs: window.endMs,
      count: config.CONTRACTOR_NOT_CONTACTED_QUERY_COUNT,
      fieldsOverride: candidateFields,
    });
    for (const candidate of candidates) {
      if (seenCandidateIds.has(candidate.id)) continue;
      seenCandidateIds.add(candidate.id);
      candidateItems.push({ candidate, queryDate });
    }
  }

  const placementItems = [];
  for (const item of candidateItems) {
    const placements = await bullhorn.queryPlacementsByCandidateId({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      candidateId: item.candidate.id,
      count: config.CONTRACTOR_NOT_CONTACTED_QUERY_COUNT,
      fieldsOverride: placementFields,
    });
    for (const placement of placements) {
      placementItems.push({
        candidate: { ...item.candidate, ...placement.candidate },
        placement,
        queryDate: item.queryDate,
      });
    }
  }

  const matchedPlacements = [];
  const skippedPlacements = [];
  const sparkPostPayload = [];
  const transmissions = [];
  let skippedRuleMismatch = 0;
  let skippedMissingJobOrderOwnerEmail = 0;
  let skippedAlreadySent = 0;
  let sendLockUnavailable = 0;

  for (const item of placementItems) {
    const placement = {
      ...item.placement,
      candidate: item.candidate,
    };
    const matchDetails = getMatchDetails({ placement, candidate: item.candidate, dateField, actionTypeField });
    if (!matchesPlacement({ placement, candidate: item.candidate, dateField, actionTypeField })) {
      skippedRuleMismatch += 1;
      skippedPlacements.push({ placementId: placement.id, candidateId: item.candidate.id, reason: "rule-filter-mismatch", matchDetails });
      continue;
    }
    const transmissionPayload = buildTransmission({ placement });
    if (transmissionPayload.recipientEnvelope.missingJobOrderOwnerEmail) {
      skippedMissingJobOrderOwnerEmail += 1;
      skippedPlacements.push({ placementId: placement.id, candidateId: item.candidate.id, reason: "missing-job-order-owner-email", matchDetails });
      continue;
    }

    let sendLock = { skipped: true, reserved: true, reason: "dry-run" };
    const entityId = `${placement.id}:${item.queryDate}`;
    if (!config.DRY_RUN) {
      sendLock = await reserveWorkflowSend({
        config,
        workflowName: WORKFLOW_NAME,
        entityType: "placement-last-contact",
        entityId,
        metadata: { businessDate: businessDateKey, queryDate: item.queryDate, candidateId: item.candidate.id, dateField },
      });
      if (!sendLock.reserved) {
        skippedAlreadySent += 1;
        continue;
      }
      if (sendLock.skipped) sendLockUnavailable += 1;
    }

    matchedPlacements.push({
      placementId: placement.id,
      candidateId: item.candidate.id,
      queryDate: item.queryDate,
      matchDetails,
      sendLock,
      recipient: transmissionPayload.recipientEnvelope,
      sparkPostPayload: transmissionPayload,
      placement,
    });
    sparkPostPayload.push(transmissionPayload);

    if (!config.DRY_RUN) {
      try {
        const transmission = await sparkPost.sendInlineTransmission({
          content: transmissionPayload.content,
          recipients: transmissionPayload.recipients,
          audit: {
            workflowName: WORKFLOW_NAME,
            sendType: "reminder",
            recipientType: "job-order-owner",
            recipientEmail: transmissionPayload.recipientEnvelope.toEmail,
            placementId: placement.id,
            candidateId: item.candidate.id,
            businessDate: businessDateKey,
            runDate: businessDateKey,
            metadata: { queryDate: item.queryDate, dateField, actionTypeField },
          },
        });
        transmissions.push({ placementId: placement.id, candidateId: item.candidate.id, transmission });
      } catch (error) {
        if (!sendLock.skipped) {
          await releaseWorkflowSend({ config, workflowName: WORKFLOW_NAME, entityType: "placement-last-contact", entityId }).catch(() => {});
        }
        throw error;
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    businessDate: businessDateKey,
    queryDates,
    fieldMapping: { dateField, actionTypeField },
    totals: {
      totalCandidatesQueried: candidateItems.length,
      totalPlacementsQueried: placementItems.length,
      matchedPlacements: matchedPlacements.length,
      skippedRuleMismatch,
      skippedMissingJobOrderOwnerEmail,
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
    skippedPlacements,
  };
  const reportPath = await writeJsonArtifact({ filePrefix: "contractor-not-contacted-reminder-report", payload: report });
  const sparkPostPayloadReportPath = await writeJsonArtifact({ filePrefix: "contractor-not-contacted-reminder-sparkpost-payload", payload: sparkPostPayload });
  return buildWorkflowResult({ workflowName: WORKFLOW_NAME, report, artifacts: { reportPath, sparkPostPayloadReportPath } });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Contractor not contacted reminder sync failed");
    process.exitCode = 1;
  });
}

module.exports = { buildCandidateFields, buildPlacementFields, run };
