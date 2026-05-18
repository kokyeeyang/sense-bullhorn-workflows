require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { upsertWorkflowSurveyTracking } = require("../stores/workflowSurveyTrackingStore");
const {
  RULES,
  WORKFLOW_NAME,
  buildInitialTransmission,
  buildTrackingRecord,
} = require("../utils/soHowDidWeDoFeedbackUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");
const { PLACEMENT_FIELDS } = require("./soHowDidWeDoFeedbackSync");

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return "";
  }

  return process.argv[index + 1];
}

function hasArg(name) {
  return process.argv.includes(name);
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function getLatestPlacement(placements) {
  return [...placements].sort((left, right) => {
    const leftDate = Number(left.dateBegin || left.dateEnd || 0);
    const rightDate = Number(right.dateBegin || right.dateEnd || 0);
    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return Number(right.id || 0) - Number(left.id || 0);
  })[0] || null;
}

async function writeTestSendReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "so-how-did-we-do-feedback-test-send",
    payload: report,
  });
}

function validateConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  if (!config.WORKFLOW_SURVEY_RESPONSE_BASE_URL) missing.push("WORKFLOW_SURVEY_RESPONSE_BASE_URL");
  if (!config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET) {
    missing.push("WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required feedback test-send config: ${missing.join(", ")}`);
  }
}

async function run(options = {}) {
  const baseConfig = loadConfig();
  const config = {
    ...baseConfig,
    DRY_RUN: options.send ? false : baseConfig.DRY_RUN,
  };
  validateConfig(config);

  const candidateId =
    normalizeNumber(options.candidateId) ||
    normalizeNumber(getArgValue("--candidate-id")) ||
    normalizeNumber(config.TEST_CANDIDATE_ID);
  if (!candidateId) {
    throw new Error("Provide a candidate id with --candidate-id 2923234 or TEST_CANDIDATE_ID");
  }

  const ruleKey = options.ruleKey || getArgValue("--rule-key") || "candidate-start-contract";
  const rule = RULES.find((item) => item.key === ruleKey);
  if (!rule) {
    throw new Error(`Unknown SO How Did We Do rule key: ${ruleKey}`);
  }
  if (rule.recipientType !== "candidate") {
    throw new Error(`Test send rule must target a candidate recipient: ${ruleKey}`);
  }

  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      candidateId,
      ruleKey,
    },
    "Starting SO How Did We Do feedback candidate test send",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const placements = await bullhorn.queryPlacementsByCandidateId({
    ...session,
    candidateId,
    count: 100,
    fieldsOverride: PLACEMENT_FIELDS,
  });
  const latestPlacement = getLatestPlacement(placements);
  const candidate = latestPlacement?.candidate || await bullhorn.getCandidate({
    ...session,
    candidateId,
  });

  const placement = latestPlacement || {
    id: null,
    status: "",
    employmentType: "",
    candidate,
    owner: {},
    clientCorporation: {},
    clientContact: {},
    billingClientContact: {},
  };

  const businessDateKey = new Date().toISOString().slice(0, 10);
  const transmissionPayload = buildInitialTransmission({
    placement,
    rule,
    config,
    businessDateKey,
  });

  if (transmissionPayload.recipientEnvelope.missingToEmail) {
    throw new Error(`Candidate ${candidateId} does not have an email address in Bullhorn`);
  }

  const trackingRecord = buildTrackingRecord({
    placement,
    rule,
    businessDateKey,
    transmissionPayload,
  });

  let transmission = null;
  let trackingResult = null;
  if (!config.DRY_RUN) {
    transmission = await sparkPost.sendInlineTransmission(transmissionPayload);
    trackingResult = await upsertWorkflowSurveyTracking({
      config,
      tracking: trackingRecord,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    workflowName: WORKFLOW_NAME,
    candidateId,
    candidateEmail: transmissionPayload.recipientEnvelope.toEmail,
    placementId: placement.id ?? null,
    ruleKey,
    surveyKey: transmissionPayload.tracking.surveyKey,
    sent: !config.DRY_RUN,
    transmission,
    trackingResult,
    sparkPostPayload: transmissionPayload,
  };
  const reportPath = await writeTestSendReport({ report });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      candidateId,
      candidateEmail: report.candidateEmail,
      placementId: report.placementId,
      reportPath,
      transmission,
      trackingResult,
    },
    "SO How Did We Do feedback candidate test send complete",
  );

  return buildWorkflowResult({
    workflowName: WORKFLOW_NAME,
    report,
    artifacts: { reportPath },
  });
}

if (require.main === module) {
  run({ send: hasArg("--send") }).catch((error) => {
    logger.error(serializeError(error), "SO How Did We Do feedback candidate test send failed");
    process.exitCode = 1;
  });
}

module.exports = { getLatestPlacement, run };
