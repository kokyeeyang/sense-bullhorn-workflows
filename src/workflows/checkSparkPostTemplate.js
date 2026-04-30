require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { SparkPostClient } = require("../clients/sparkPostClient");

async function run() {
  const config = loadConfig();
  const sparkPost = new SparkPostClient({ config, logger });
  const templateId = config.SPARKPOST_TEMPLATE_ID || "test-yy";

  if (!config.SPARKPOST_API_KEY) {
    throw new Error("Missing SparkPost API key. Set SPARKPOST_API_KEY or BULLHORN_WORKFLOW.");
  }

  logger.info(
    {
      apiBaseUrl: config.SPARKPOST_API_BASE_URL,
      templateId,
    },
    "Checking SparkPost template visibility",
  );

  const result = await sparkPost.getTemplate(templateId);
  const template = result?.results || null;

  logger.info(
    {
      templateId: template?.id || templateId,
      templateName: template?.name || null,
      published: template?.published ?? null,
      hasPublished: template?.has_published ?? null,
      description: template?.description || null,
    },
    "SparkPost template is visible to current API key",
  );

  return result;
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
      "SparkPost template check failed",
    );
    process.exitCode = 1;
  });
}

module.exports = { run };
