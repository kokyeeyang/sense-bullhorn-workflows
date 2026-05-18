const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const {
  buildPlacementFields,
  buildReportRecord,
  dateKeyToEndMs,
  dateKeyToStartMs,
  isLastContactOverdue,
  normalizeFilters,
  placementMatchesCommonFilters,
} = require("../utils/candidateAssignmentStatusReportUtils");
const {
  serializeError,
} = require("../utils/workflowRuntime");

function getQueryValue(request, key) {
  return request.query.get(key) || null;
}

function findStatusChange(record) {
  const changes = Array.isArray(record?.fieldChanges)
    ? record.fieldChanges
    : Array.isArray(record?.fieldChanges?.data)
      ? record.fieldChanges.data
      : [];
  return changes.find((change) =>
    String(change?.columnName || change?.fieldName || "").trim().toLowerCase() === "status",
  ) || null;
}

async function fetchTerminatedPlacements({ bullhorn, session, filters, placementFields }) {
  const records = await bullhorn.queryPlacementEditHistoryByDateAddedRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: dateKeyToStartMs(filters.dateFrom),
    endMs: dateKeyToEndMs(filters.dateTo),
    count: Math.min(filters.limit, 200),
    maxCount: filters.limit,
  });
  const output = [];
  const seen = new Set();

  for (const record of records) {
    const placementId = Number(record?.targetEntity?.id || 0);
    const statusChange = findStatusChange(record);
    if (!placementId || String(statusChange?.newValue || "").trim().toLowerCase() !== "terminated") {
      continue;
    }
    if (seen.has(placementId)) continue;
    seen.add(placementId);
    const placement = await bullhorn.getPlacementByIdWithFields({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      placementId,
      fields: placementFields,
    });
    if (placementMatchesCommonFilters(placement, filters)) {
      output.push({ caseType: "terminated-placement", placement, statusChange });
    }
    if (output.length >= filters.limit) break;
  }
  return output;
}

async function fetchCompletedContractAssignments({ bullhorn, session, filters, placementFields }) {
  const placements = await bullhorn.queryPlacementsByDateEndRange({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    startMs: dateKeyToStartMs(filters.dateFrom),
    endMs: dateKeyToEndMs(filters.dateTo),
    count: Math.min(filters.limit, 200),
    maxCount: filters.limit,
    fieldsOverride: placementFields,
  });
  return placements
    .filter((placement) =>
      String(placement?.status || "").trim().toLowerCase() === "completed" &&
      String(placement?.employmentType || placement?.jobOrder?.employmentType || "").trim().toLowerCase() === "contract" &&
      placementMatchesCommonFilters(placement, filters),
    )
    .slice(0, filters.limit)
    .map((placement) => ({ caseType: "completed-contract-assignment", placement }));
}

async function fetchLastContactOverduePlacements({ bullhorn, session, filters, placementFields }) {
  const where = [
    "status='Approved'",
    "employmentType='Contract'",
    `dateBegin<${dateKeyToEndMs(filters.dateTo)}`,
    `dateEnd>=${dateKeyToStartMs(filters.dateFrom)}`,
  ].join(" AND ");
  const placements = await bullhorn.queryPlacementsWhere({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    where,
    count: Math.min(filters.limit, 200),
    maxCount: filters.limit,
    fieldsOverride: placementFields,
  });

  return placements
    .filter((placement) =>
      isLastContactOverdue(placement, { notContactedDays: filters.notContactedDays }) &&
      placementMatchesCommonFilters(placement, filters),
    )
    .slice(0, filters.limit)
    .map((placement) => ({ caseType: "contractor-last-contact-overdue", placement }));
}

async function runReport(filters) {
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });
  const placementFields = buildPlacementFields();
  const code = await bullhorn.getAuthorizationCode();
  const accessToken = await bullhorn.getAccessToken(code);
  const session = await bullhorn.login(accessToken);
  const rawRecords = [];

  if (filters.caseTypes.includes("terminated-placement")) {
    rawRecords.push(...await fetchTerminatedPlacements({ bullhorn, session, filters, placementFields }));
  }
  if (filters.caseTypes.includes("completed-contract-assignment")) {
    rawRecords.push(...await fetchCompletedContractAssignments({ bullhorn, session, filters, placementFields }));
  }
  if (filters.caseTypes.includes("contractor-last-contact-overdue")) {
    rawRecords.push(...await fetchLastContactOverduePlacements({ bullhorn, session, filters, placementFields }));
  }

  const seen = new Set();
  const records = [];
  for (const item of rawRecords) {
    const key = `${item.caseType}:${item.placement?.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(buildReportRecord({
      caseType: item.caseType,
      placement: item.placement,
      statusChange: item.statusChange,
      notContactedDays: filters.notContactedDays,
    }));
    if (records.length >= filters.limit) break;
  }

  return {
    generatedAt: new Date().toISOString(),
    filters,
    count: records.length,
    records,
  };
}

async function handleCandidateAssignmentStatusReport(request, context) {
  context.log("Candidate assignment status report request received");

  try {
    const filters = normalizeFilters({
      dateFrom: getQueryValue(request, "dateFrom"),
      dateTo: getQueryValue(request, "dateTo"),
      caseTypes: getQueryValue(request, "caseTypes"),
      assignmentCountry: getQueryValue(request, "assignmentCountry"),
      candidateCountry: getQueryValue(request, "candidateCountry"),
      employmentType: getQueryValue(request, "employmentType"),
      notContactedDays: getQueryValue(request, "notContactedDays"),
      limit: getQueryValue(request, "limit"),
    });
    const report = await runReport(filters);

    return {
      status: 200,
      jsonBody: {
        success: true,
        data: report,
      },
    };
  } catch (error) {
    context.error(serializeError(error), "Candidate assignment status report failed");
    return {
      status: error.message?.startsWith("Invalid") || error.message?.startsWith("Unsupported") ? 400 : 500,
      jsonBody: {
        success: false,
        error: {
          message: error.message || "Candidate assignment status report failed",
          name: error.name || "Error",
        },
      },
    };
  }
}

module.exports = {
  handleCandidateAssignmentStatusReport,
  runReport,
};
