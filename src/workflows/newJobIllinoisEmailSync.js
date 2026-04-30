require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { SparkPostClient } = require("../clients/sparkPostClient");
const {
  buildNewJobIllinoisRecipient,
  buildUtcAgeWindow,
  matchesNewJobIllinoisJobOrder,
} = require("../utils/newJobIllinoisEmailUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("../utils/workflowRuntime");

function getTemplateId(config) {
  return config.NEW_JOB_ILLINOIS_SPARKPOST_TEMPLATE_ID || config.SPARKPOST_TEMPLATE_ID || null;
}

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  if (!getTemplateId(config)) {
    missing.push("NEW_JOB_ILLINOIS_SPARKPOST_TEMPLATE_ID or SPARKPOST_TEMPLATE_ID");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({
    filePrefix: "new-job-illinois-email-report",
    payload: report,
  });
}

async function writeSparkPostPayloadReport({ payload }) {
  return writeJsonArtifact({
    filePrefix: "new-job-illinois-email-sparkpost-payload",
    payload,
  });
}

async function run() {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const bullhorn = new BullhornClient({ config, logger });
  const sparkPost = new SparkPostClient({ config, logger });
  const templateId = getTemplateId(config);
  const window = buildUtcAgeWindow({
    graceHours: config.NEW_JOB_ILLINOIS_GRACE_HOURS,
  });

  logger.info(
    {
      dryRun: config.DRY_RUN,
      graceHours: config.NEW_JOB_ILLINOIS_GRACE_HOURS,
      startMs: window.startMs,
      endMs: window.endMs,
      queryCount: config.NEW_JOB_ILLINOIS_QUERY_COUNT,
      jobOrderState: config.NEW_JOB_ILLINOIS_JOB_ORDER_STATE,
      employmentType: config.NEW_JOB_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE,
      sparkPostTemplateId: templateId,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
    },
    "Starting new job Illinois email sync",
  );

  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);

  const jobOrders = await bullhorn.queryJobOrdersByDateAddedRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: window.startMs,
    endMs: window.endMs,
    count: config.NEW_JOB_ILLINOIS_QUERY_COUNT,
  });

  logger.info({ jobOrderCount: jobOrders.length }, "Fetched job orders for Illinois new job email window");

  let skippedJobOrderMismatch = 0;
  let skippedMissingOwnerId = 0;
  let skippedMissingOwnerEmail = 0;
  const matchedJobOrders = [];
  const sparkPostRecipients = [];
  const ownerCache = new Map();

  for (const jobOrder of jobOrders) {
    if (!matchesNewJobIllinoisJobOrder({ jobOrder, config })) {
      skippedJobOrderMismatch += 1;
      continue;
    }

    const ownerId = jobOrder?.owner?.id || null;
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

    const sparkPostRecipient = buildNewJobIllinoisRecipient({
      jobOrder,
      owner,
      recipientEmail: owner.email,
    });

    sparkPostRecipients.push(sparkPostRecipient);
    matchedJobOrders.push({
      jobOrderId: jobOrder.id,
      owner: {
        id: owner.id,
        firstName: owner.firstName || null,
        lastName: owner.lastName || null,
        email: owner.email,
      },
      jobOrder: {
        id: jobOrder.id,
        dateAdded: jobOrder.dateAdded || null,
        employmentType: jobOrder.employmentType || null,
        address: jobOrder.address || null,
        clientCorporation: jobOrder.clientCorporation || null,
        owner: jobOrder.owner || null,
      },
      sparkPostRecipient,
    });
  }

  let transmission = null;
  const sparkPostPayload = {
    content: {
      template_id: templateId,
    },
    recipients: sparkPostRecipients,
  };

  if (!config.DRY_RUN && sparkPostRecipients.length > 0) {
    transmission = await sparkPost.sendTransmission({
      templateId,
      recipients: sparkPostRecipients,
    });
  }

  logger.info(
    {
      totalJobOrders: jobOrders.length,
      matchedJobOrders: matchedJobOrders.length,
      recipientCount: sparkPostRecipients.length,
      skippedJobOrderMismatch,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
      sparkPostSent: !config.DRY_RUN && sparkPostRecipients.length > 0,
    },
    "New job Illinois email sync finished",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    window: {
      graceHours: config.NEW_JOB_ILLINOIS_GRACE_HOURS,
      intervalHours: window.intervalHours,
      startMs: window.startMs,
      endMs: window.endMs,
    },
    filters: {
      jobOrderState: config.NEW_JOB_ILLINOIS_JOB_ORDER_STATE,
      jobOrderEmploymentType: config.NEW_JOB_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE,
    },
    totals: {
      totalJobOrders: jobOrders.length,
      matchedJobOrders: matchedJobOrders.length,
      recipients: sparkPostRecipients.length,
      skippedJobOrderMismatch,
      skippedMissingOwnerId,
      skippedMissingOwnerEmail,
    },
    sparkPost: {
      templateId,
      recipientCount: sparkPostRecipients.length,
      sent: !config.DRY_RUN && sparkPostRecipients.length > 0,
      transmission,
      payload: sparkPostPayload,
    },
    recipients: sparkPostRecipients,
    jobOrders: matchedJobOrders,
  };

  const reportPath = await writeChangesReport({ report });
  const sparkPostPayloadReportPath = await writeSparkPostPayloadReport({
    payload: sparkPostPayload,
  });
  logger.info({ reportPath }, "New job Illinois email report written");
  logger.info(
    { sparkPostPayloadReportPath },
    "New job Illinois email SparkPost payload report written",
  );

  return buildWorkflowResult({
    workflowName: "new-job-illinois-email-sync",
    report,
    artifacts: {
      reportPath,
      sparkPostPayloadReportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "New job Illinois email sync failed");
    process.exitCode = 1;
  });
}

module.exports = {
  getTemplateId,
  run,
  writeSparkPostPayloadReport,
};
