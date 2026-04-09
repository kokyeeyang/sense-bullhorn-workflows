const fs = require("node:fs/promises");
const path = require("node:path");

function resolveReportsDir() {
  if (process.env.WEBSITE_INSTANCE_ID) {
    return path.resolve(process.env.TMPDIR || process.env.TEMP || "/tmp", "reports");
  }

  return path.resolve(process.cwd(), "reports");
}

async function writeJsonArtifact({ filePrefix, payload }) {
  const reportsDir = resolveReportsDir();
  await fs.mkdir(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = path.join(reportsDir, `${filePrefix}-${timestamp}.json`);
  await fs.writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return artifactPath;
}

function buildWorkflowResult({ workflowName, report, artifacts = {} }) {
  return {
    ...(report || {}),
    workflow: workflowName,
    report,
    artifacts,
  };
}

function normalizeWorkflowResult(result) {
  if (result && typeof result === "object" && result.report) {
    return result;
  }

  return {
    workflow: null,
    report: result,
    artifacts: {},
  };
}

function serializeError(error) {
  return {
    message: error.message,
    stack: error.stack,
    responseStatus: error.response?.status || null,
    responseData: error.response?.data || null,
  };
}

function buildHttpSuccessPayload({ workflowName, result, trigger, startedAt, finishedAt }) {
  const normalized = normalizeWorkflowResult(result);
  const report = normalized.report || {};

  return {
    workflow: workflowName,
    status: "success",
    trigger,
    startedAt,
    finishedAt,
    dryRun: report.dryRun ?? null,
    totals: report.totals || null,
    artifacts: normalized.artifacts || {},
    report,
  };
}

function buildHttpErrorPayload({ workflowName, error, trigger, startedAt, finishedAt }) {
  return {
    workflow: workflowName,
    status: "error",
    trigger,
    startedAt,
    finishedAt,
    error: serializeError(error),
  };
}

module.exports = {
  buildHttpErrorPayload,
  buildHttpSuccessPayload,
  buildWorkflowResult,
  serializeError,
  writeJsonArtifact,
};
