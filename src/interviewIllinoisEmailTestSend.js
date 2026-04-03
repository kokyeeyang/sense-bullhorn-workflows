require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { SparkPostClient } = require("./sparkPostClient");

function getTemplateId(config) {
  return config.INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID || config.SPARKPOST_TEMPLATE_ID || "interview-illinois";
}

function buildTestSparkPostPayload(config) {
  return {
    content: {
      template_id: getTemplateId(config),
    },
    recipients: [
      {
        address: {
          email: "yeeyang.kok@spencer-ogden.com",
        },
        substitution_data: {
          id: "701",
          candidateReference: {
            name: "Test Candidate",
            id: "516238",
          },
        },
      },
      {
        address: {
          email: "yee_yang94@hotmail.com",
        },
        substitution_data: {
          id: "702",
          candidateReference: {
            name: "Hotmail Candidate",
            id: "516239",
          },
        },
      },
    ],
  };
}

async function writePayloadReport({ payload }) {
  const reportsDir = path.resolve(process.cwd(), "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    reportsDir,
    `interview-illinois-email-sparkpost-test-payload-${timestamp}.json`,
  );
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return reportPath;
}

function validateSparkPostConfig(config) {
  const missing = [];
  if (!config.DRY_RUN && !config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  if (!config.DRY_RUN && !getTemplateId(config)) {
    missing.push("INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID or SPARKPOST_TEMPLATE_ID");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(", ")}`);
  }
}

async function run() {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const sparkPost = new SparkPostClient({ config, logger });
  const payload = buildTestSparkPostPayload(config);

  logger.info(
    {
      dryRun: config.DRY_RUN,
      templateId: payload.content.template_id,
      recipientCount: payload.recipients.length,
    },
    "Starting interview Illinois email SparkPost test send",
  );

  const reportPath = await writePayloadReport({ payload });
  logger.info({ reportPath }, "Interview Illinois email SparkPost test payload report written");

  let transmission = null;
  if (!config.DRY_RUN) {
    transmission = await sparkPost.sendTransmission({
      templateId: payload.content.template_id,
      recipients: payload.recipients,
    });

    logger.info({ transmission }, "Interview Illinois email SparkPost test transmission sent");
  }

  return {
    dryRun: config.DRY_RUN,
    payload,
    transmission,
    reportPath,
  };
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
      "Interview Illinois email SparkPost test send failed",
    );
    process.exitCode = 1;
  });
}

module.exports = {
  buildTestSparkPostPayload,
  getTemplateId,
  run,
};
