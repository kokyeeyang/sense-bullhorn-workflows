require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { SparkPostClient } = require("./sparkPostClient");

function buildTestSparkPostPayload(config) {
  return {
    content: {
      template_id: config.PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID || "placement-termination",
    },
    recipients: [
      {
        placement: {
          id: "123456",
          status: "Terminated",
        },
        address: {
          email: "yeeyang.kok@spencer-ogden.com",
        },
        substitution_data: {
          owner_firstName: "Yee Yang",
          placement_id: "123456",
          placement_status: "Terminated",
          candidate_name: "Yee Yang Kok",
          candidate_email: "yeeyang.kok@spencer-ogden.com",
          client_company_name: "Test company 123",
          job_title: "Consultant",
          date_begin: "1 April 2026",
          date_end: "30 April 2026",
        },
      },
      {
        placement: {
          id: "432432423",
          status: "Terminated",
        },
        address: {
          email: "yee_yang94@hotmail.com",
        },
        substitution_data: {
          owner_firstName: "Yee Yang",
          placement_id: "432432423",
          placement_status: "Terminated",
          candidate_name: "Yee Yang Kok",
          candidate_email: "yee_yang94@hotmail.com",
          client_company_name: "Test company hotmail",
          job_title: "Consultant",
          date_begin: "1 April 2026",
          date_end: "30 April 2026",
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
    `placement-termination-email-sparkpost-test-payload-${timestamp}.json`,
  );
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return reportPath;
}

function validateSparkPostConfig(config) {
  const missing = [];
  if (!config.DRY_RUN && !config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");
  if (!config.DRY_RUN && !config.PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID) {
    missing.push("PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID");
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
    "Starting placement termination email SparkPost test send",
  );

  const reportPath = await writePayloadReport({ payload });
  logger.info({ reportPath }, "Placement termination email SparkPost test payload report written");

  let transmission = null;
  if (!config.DRY_RUN) {
    transmission = await sparkPost.sendTransmission({
      templateId: payload.content.template_id,
      recipients: payload.recipients,
    });

    logger.info({ transmission }, "Placement termination email SparkPost test transmission sent");
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
      "Placement termination email SparkPost test send failed",
    );
    process.exitCode = 1;
  });
}

module.exports = {
  buildTestSparkPostPayload,
  run,
};
