require("dotenv").config();
const fs = require("node:fs/promises");

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { buildJsonArtifactPath } = require("../utils/workflowRuntime");

function buildTestSparkPostPayload(config) {
  return {
    content: {
      template_id:
        config.PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID ||
        config.SPARKPOST_TEMPLATE_ID ||
        "placement-yearly-fee-increase",
    },
    recipients: [
      {
        address: {
          email: "yeeyang.kok@spencer-ogden.com",
        },
        substitution_data: {
          owner_firstName: "Yee Yang Kok",
          client_company_name: "Test company 123",
          yearly_fee_increase_percent: "5",
          placement_id: "123456",
          candidate_name: "Test Candidate",
          placement_start_date: "7 April 2025",
          placement_end_date: "7 April 2026",
          job_title: "Offshore Lead Cables Engineer",
          tob_date: "1 January 2024",
        },
      },
      {
        address: {
          email: "yee_yang94@hotmail.com",
        },
        substitution_data: {
          owner_firstName: "Yee Yang Kok",
          client_company_name: "Test company hotmail",
          yearly_fee_increase_percent: "3",
          placement_id: "432432423",
          candidate_name: "Test Candidate Two",
          placement_start_date: "8 April 2025",
          placement_end_date: "8 April 2026",
          job_title: "Senior Consultant",
          tob_date: "15 February 2024",
        },
      },
    ],
  };
}

async function writePayloadReport({ payload }) {
  const { reportsDir, artifactPath: reportPath } = buildJsonArtifactPath({
    filePrefix: "placement-yearly-fee-increase-sparkpost-test-payload",
  });
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return reportPath;
}

function validateSparkPostConfig(config) {
  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
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
      forcedSend: true,
      templateId: payload.content.template_id,
      recipientCount: payload.recipients.length,
    },
    "Starting placement yearly fee increase SparkPost test send",
  );

  const reportPath = await writePayloadReport({ payload });
  logger.info({ reportPath }, "Placement yearly fee increase SparkPost test payload report written");

  const transmission = await sparkPost.sendTransmission({
    templateId: payload.content.template_id,
    recipients: payload.recipients,
  });

  logger.info({ transmission }, "Placement yearly fee increase SparkPost test transmission sent");

  return {
    dryRun: config.DRY_RUN,
    forcedSend: true,
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
      "Placement yearly fee increase SparkPost test send failed",
    );
    process.exitCode = 1;
  });
}

module.exports = { buildTestSparkPostPayload, run };
