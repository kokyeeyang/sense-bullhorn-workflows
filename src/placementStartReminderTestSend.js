require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { SparkPostClient } = require("./sparkPostClient");

function resolveTestRecipientEmails(config) {
  const configuredRecipients = config.PLACEMENT_START_REMINDER_TEST_RECIPIENTS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configuredRecipients && configuredRecipients.length > 0) {
    return configuredRecipients;
  }

  return [
    "yeeyang@spencer-ogden.com",
    "yee_yang94@hotmail.com",
  ];
}

function buildTestSparkPostPayload(config) {
  const [primaryRecipient, secondaryRecipient] = resolveTestRecipientEmails(config);

  return {
    content: {
      template_id: config.SPARKPOST_TEMPLATE_ID || "test-yy",
    },
    recipients: [
      {
        address: {
          email: primaryRecipient,
        },
        substitution_data: {
          placement_id: "123456",
          jobOrderOwner_firstName: "Yee Yang",
          candidate_name: "Test Candidate",
          client_company_name: "Test company 123",
          date_begin: "31 April 2026",
          so_entity: "SO Italy",
          legal_entity_name: "Test company so legal entity name",
          billingClientContact_country_name: "Italy",
          tob_agreed: "Yes",
          po_required: "Yes",
          po_number: "PO-778899",
          finance_ref_number: "XXECOS01",
          billingClientContact_name: "Danilo Contu",
          billingClientContact_full_address:
            "Via Ricotti, 5 Voghera (PV) Italy, Voghera, N/A, 27058, Italy",
        },
      },
      {
        address: {
          email: secondaryRecipient || primaryRecipient,
        },
        substitution_data: {
          placement_id: "432432423",
          jobOrderOwner_firstName: "Yee Yang",
          candidate_name: "Test Candidate",
          client_company_name: "Test company hotmail",
          date_begin: "31 April 2026",
          so_entity: "SO Malaysia",
          legal_entity_name: "Test company hotmail legal entity name",
          billingClientContact_country_name: "Malaysia",
          tob_agreed: "Yes",
          po_required: "Yes",
          po_number: "PO-123456",
          finance_ref_number: "XXECOS01",
          billingClientContact_name: "Tom",
          billingClientContact_full_address:
            "asdasdas",
        },
      }
    ],
  };
}

async function writePayloadReport({ payload }) {
  const reportsDir = path.resolve(process.cwd(), "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    reportsDir,
    `placement-start-reminder-sparkpost-test-payload-${timestamp}.json`,
  );
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return reportPath;
}

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

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
      templateId: payload.content.template_id,
      recipientCount: payload.recipients.length,
    },
    "Starting placement reminder SparkPost test send",
  );

  const reportPath = await writePayloadReport({ payload });
  logger.info({ reportPath }, "Placement reminder SparkPost test payload report written");

  let transmission = null;
  if (!config.DRY_RUN) {
    transmission = await sparkPost.sendTransmission({
      templateId: payload.content.template_id,
      recipients: payload.recipients,
    });

    logger.info(
      {
        transmission,
      },
      "Placement reminder SparkPost test transmission sent",
    );
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
      "Placement reminder SparkPost test send failed",
    );
    process.exitCode = 1;
  });
}

module.exports = { buildTestSparkPostPayload, resolveTestRecipientEmails, run };
