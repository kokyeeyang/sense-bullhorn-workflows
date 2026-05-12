require("dotenv").config();
const fs = require("node:fs/promises");

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { SparkPostClient } = require("../clients/sparkPostClient");
const { BENEFITS_REMINDER_STAGES } = require("../utils/placementBenefitsReminderUtils");
const { buildJsonArtifactPath } = require("../utils/workflowRuntime");

function buildDummyPlacements() {
  return [
    {
      id: 123456,
      dateBegin: Date.UTC(2026, 3, 7, 0, 0, 0, 0),
      candidate: {
        firstName: "Yee Yang",
        lastName: "Kok",
        email: "kokyeeyang1994@gmail.com",
        owner: {
          email: "yeeyang.kok@spencer-ogden.com",
        },
      },
      jobOrder: {
        owner: {
          email: "yeeyang.kok@spencer-ogden.com",
        },
      },
    },
    {
      id: 654321,
      dateBegin: Date.UTC(2026, 3, 8, 0, 0, 0, 0),
      candidate: {
        firstName: "Yee Yang Hotmail",
        lastName: "Test",
        email: "yee_yang94@hotmail.com",
        owner: {
          email: "yeeyang.kok@spencer-ogden.com",
        },
      },
      jobOrder: {
        owner: {
          email: "yeeyang.kok@spencer-ogden.com",
        },
      },
    },
  ];
}

function buildStagePayloads({ stage, placements, config }) {
  return placements.map((placement) => {
    const toEmail = placement.candidate.email;
    const ccEmails = stage.includeCcRecipients
      ? [placement.jobOrder.owner.email, placement.candidate.owner.email]
      : [];
    const substitution_data = {
      candidate_first_name: placement.candidate.firstName,
      candidate_name: `${placement.candidate.firstName} ${placement.candidate.lastName}`,
      placement_id: String(placement.id),
      placement_start_date: placement.id === 123456 ? "7 April 2026" : "8 April 2026",
      reminder_stage: stage.label,
      reminder_day_offset: String(stage.dayOffset),
    };

    return {
      stage: {
        key: stage.key,
        label: stage.label,
        dayOffset: stage.dayOffset,
      },
      content: {
        template_id:
          config[stage.templateConfigKey] || `placement-benefits-reminder-${stage.label}`,
        ...(ccEmails.length > 0 ? { headers: { CC: ccEmails.join(", ") } } : {}),
      },
      recipients: [
        {
          address: {
            email: toEmail,
          },
          substitution_data,
        },
        ...ccEmails.map((email) => ({
          address: {
            email,
            header_to: toEmail,
          },
          substitution_data,
        })),
      ],
    };
  });
}

function buildTestSparkPostPayloads(config) {
  const placements = buildDummyPlacements();

  return BENEFITS_REMINDER_STAGES.flatMap((stage) =>
    buildStagePayloads({ stage, placements, config }),
  );
}

async function writePayloadReport({ payload }) {
  const { reportsDir, artifactPath: reportPath } = buildJsonArtifactPath({
    filePrefix: "placement-benefits-reminder-sparkpost-test-payload",
  });
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return reportPath;
}

function validateSparkPostConfig(config) {
  if (config.DRY_RUN) {
    return;
  }

  const missing = [];
  if (!config.SPARKPOST_API_KEY) missing.push("SPARKPOST_API_KEY or BULLHORN_WORKFLOW");

  for (const stage of BENEFITS_REMINDER_STAGES) {
    if (!config[stage.templateConfigKey]) {
      missing.push(stage.templateConfigKey);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required SparkPost config: ${missing.join(", ")}`);
  }
}

async function run() {
  const config = loadConfig();
  validateSparkPostConfig(config);
  const sparkPost = new SparkPostClient({ config, logger });
  const payload = buildTestSparkPostPayloads(config);

  logger.info(
    {
      dryRun: config.DRY_RUN,
      stageCount: payload.length,
      recipientCount: payload.reduce((total, item) => total + item.recipients.length, 0),
    },
    "Starting placement benefits reminder SparkPost test send",
  );

  const reportPath = await writePayloadReport({ payload });
  logger.info(
    { reportPath },
    "Placement benefits reminder SparkPost test payload report written",
  );

  const transmissions = [];
  if (!config.DRY_RUN) {
    for (const stagePayload of payload) {
      const transmission = await sparkPost.sendTransmission({
        templateId: stagePayload.content.template_id,
        recipients: stagePayload.recipients,
        headers: stagePayload.content.headers,
      });

      transmissions.push({
        stage: stagePayload.stage.label,
        placementId: Number(
          stagePayload.recipients?.[0]?.substitution_data?.placement_id || 0,
        ) || null,
        transmission,
      });
    }

    logger.info({ transmissions }, "Placement benefits reminder SparkPost test transmissions sent");
  }

  return {
    dryRun: config.DRY_RUN,
    payload,
    transmissions,
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
      "Placement benefits reminder SparkPost test send failed",
    );
    process.exitCode = 1;
  });
}

module.exports = { buildTestSparkPostPayloads, run };
