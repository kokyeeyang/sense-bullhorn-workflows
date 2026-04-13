function sumNumericValuesByKeyPrefix(source, prefix) {
  if (!source || typeof source !== "object") {
    return 0;
  }

  return Object.entries(source).reduce((total, [key, value]) => {
    if (!key.startsWith(prefix) || typeof value !== "number" || Number.isNaN(value)) {
      return total;
    }

    return total + value;
  }, 0);
}

function pickFirstNumericValue(source, keys) {
  if (!source || typeof source !== "object") {
    return 0;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
  }

  return 0;
}

function buildWorkflowRunSummary({ workflowName, result, error }) {
  if (error) {
    return {
      successCount: 0,
      failureCount: 1,
      skippedCount: 0,
      summary: `${workflowName} failed before completing`,
      details: {
        message: error.message,
        responseStatus: error.response?.status || null,
      },
      artifactPath: null,
    };
  }

  const report = result?.report || {};
  const totals = report?.totals || {};

  const successCount = pickFirstNumericValue(totals, [
    "updated",
    "recipients",
    "matchedPlacements",
    "affectedCandidates",
    "matchedClientCorporations",
    "matchedClientContacts",
    "processedRecords",
  ]);
  const failureCount = pickFirstNumericValue(totals, ["failed", "failures", "errorCount"]);
  const skippedCount = sumNumericValuesByKeyPrefix(totals, "skipped");

  return {
    successCount,
    failureCount,
    skippedCount,
    summary: `${workflowName} completed with ${successCount} successful items, ${failureCount} failed items, and ${skippedCount} skipped items`,
    details: {
      dryRun: report?.dryRun ?? null,
      totals,
    },
    artifactPath: result?.artifacts?.reportPath || null,
  };
}

module.exports = { buildWorkflowRunSummary };
