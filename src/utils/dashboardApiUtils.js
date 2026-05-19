const { DASHBOARD_EMAIL_WORKFLOWS, DASHBOARD_WORKFLOWS } = require("./dashboardWorkflows");

const MAX_DASHBOARD_RANGE_DAYS = 92;
const DEFAULT_DASHBOARD_RANGE_DAYS = 7;

const WORKFLOW_CATEGORIES = {
  "candidate-state-sync": "candidate",
  "placement-database-enrichment-sync": "data-enrichment",
  "placement-status-sync": "placement",
  "placement-termination-email-sync": "email",
  "placement-termination-workflows-sync": "email",
  "interview-illinois-email-sync": "email",
  "job-application-notification-sync": "email",
  "vestas-po-sync": "email",
  "approved-placement-apac-sync": "email",
  "awr-client-request-sync": "email",
  "contractor-not-contacted-reminder-sync": "email",
  "new-job-illinois-email-sync": "email",
  "placement-start-reminder-sync": "email",
  "americas-onboarding-notices-sync": "email",
  "americas-internal-placement-notices-sync": "email",
  "ais-survivex-certification-sync": "email",
  "americas-welcome-contract-email-sync": "email",
  "fair-collection-notice-sync": "email",
  "perm-checkin-sync": "email",
  "emea-placement-auto-reply-sync": "email",
  "so-how-did-we-do-feedback-sync": "survey",
  "start-date-approval-reminder-sync": "survey",
  "placement-benefits-reminder-sync": "email",
  "us-client-extension-notification-sync": "survey",
  "us-contract-performance-checkin-sync": "survey",
  "harassment-training-sync": "compliance",
  "placement-yearly-fee-increase-sync": "email",
  "client-contact-dnc-sync": "client",
  "client-corporation-360-sync": "client",
  "client-corporation-key-account-sync": "client",
};

const WORKFLOW_METADATA = {
  "candidate-state-sync": {
    label: "Candidate State Sync",
    description: "Normalizes candidate phone and location data used by downstream workflows.",
  },
  "placement-database-enrichment-sync": {
    label: "Placement Database Enrichment",
    description: "Keeps placement and candidate database fields aligned after Bullhorn placement changes.",
  },
  "placement-status-sync": {
    label: "Placement Status Sync",
    description: "Applies placement status updates from Bullhorn event changes.",
  },
  "placement-termination-email-sync": {
    label: "Placement Termination Email",
    description: "Sends candidate termination notices for configured placement exits.",
  },
  "placement-termination-workflows-sync": {
    label: "Placement Termination Workflows",
    description: "Runs state and contract termination notice workflows based on end dates and status changes.",
  },
  "interview-illinois-email-sync": {
    label: "Illinois Interview Email",
    description: "Sends Illinois-specific interview notices for matching job activity.",
  },
  "job-application-notification-sync": {
    label: "Job Application Notification",
    description: "Alerts job owners when new candidate applications arrive from configured sources.",
  },
  "approved-placement-apac-sync": {
    label: "APAC Approved Placement",
    description: "Notifies APAC teams when relevant placements reach approved status.",
  },
  "awr-client-request-sync": {
    label: "AWR Client Request",
    description: "Sends Agency Workers Regulations client declaration requests.",
  },
  "contractor-not-contacted-reminder-sync": {
    label: "Contractor Not Contacted Reminder",
    description: "Reminds owners to contact contractors without recent contact activity.",
  },
  "new-job-illinois-email-sync": {
    label: "New Job Illinois Email",
    description: "Sends Illinois notices for newly created contract job orders.",
  },
  "placement-start-reminder-sync": {
    label: "Placement Start Reminder",
    description: "Reminds owners about upcoming placement start requirements.",
  },
  "americas-onboarding-notices-sync": {
    label: "Americas Onboarding Notices",
    description: "Sends required US onboarding and policy notices to candidates.",
  },
  "americas-internal-placement-notices-sync": {
    label: "Americas Internal Placement Notices",
    description: "Notifies internal Americas teams about qualifying placement events.",
  },
  "ais-survivex-certification-sync": {
    label: "AIS Survivex Certification",
    description: "Sends certification renewal reminders for AIS Survivex contractors.",
  },
  "americas-welcome-contract-email-sync": {
    label: "Americas Welcome Contract Email",
    description: "Sends welcome and onboarding instructions to US contract candidates.",
  },
  "fair-collection-notice-sync": {
    label: "Fair Collection Notice",
    description: "Sends fair collection notices where required for onboarding.",
  },
  "perm-checkin-sync": {
    label: "Perm Check-in",
    description: "Sends check-in surveys for permanent placement follow-up.",
  },
  "emea-placement-auto-reply-sync": {
    label: "EMEA Placement Auto Reply",
    description: "Sends EMEA placement auto-reply communications.",
  },
  "so-how-did-we-do-feedback-sync": {
    label: "How Did We Do Feedback",
    description: "Requests candidate feedback after placement milestones.",
  },
  "start-date-approval-reminder-sync": {
    label: "Start Date Approval Reminder",
    description: "Requests approval or confirmation for placement start dates.",
  },
  "placement-benefits-reminder-sync": {
    label: "Placement Benefits Reminder",
    description: "Sends US benefits enrollment reminders at configured placement milestones.",
  },
  "payroll-new-hire-greeting-sync": {
    label: "Payroll New Hire Greeting",
    description: "Sends payroll setup guidance to US contract candidates on their start date.",
  },
  "placement-end-date-reminder-sync": {
    label: "Placement End Date Reminder",
    description: "Reminds sales owners 90 and 60 days before contract placement end dates.",
  },
  "us-client-extension-notification-sync": {
    label: "US Client Extension Notification",
    description: "Asks US clients whether active contractors should extend six weeks before end date.",
  },
  "us-contract-performance-checkin-sync": {
    label: "US Contract Performance Check-in",
    description: "Sends performance check-in surveys for US contract placements.",
  },
  "harassment-training-sync": {
    label: "Harassment Training",
    description: "Sends state-specific harassment training notices and confirmations.",
  },
  "placement-yearly-fee-increase-sync": {
    label: "Placement Yearly Fee Increase",
    description: "Notifies stakeholders about yearly contract fee increases.",
  },
  "client-contact-dnc-sync": {
    label: "Client Contact DNC Sync",
    description: "Updates client contact do-not-contact status from Bullhorn changes.",
  },
  "client-corporation-360-sync": {
    label: "Client Corporation 360 Sync",
    description: "Maintains client corporation 360 classification data.",
  },
  "client-corporation-key-account-sync": {
    label: "Client Corporation Key Account Sync",
    description: "Maintains key account classification data for client corporations.",
  },
};

function titleCaseWorkflowName(workflowName) {
  return String(workflowName || "")
    .replace(/-sync$/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getWorkflowMetadata(workflowName) {
  return {
    label: WORKFLOW_METADATA[workflowName]?.label || titleCaseWorkflowName(workflowName),
    description: WORKFLOW_METADATA[workflowName]?.description || "Workflow automation.",
  };
}

function formatDateOnly(value) {
  return String(value || "").slice(0, 10);
}

function parseDateOnly(value, label = "date") {
  const normalized = formatDateOnly(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function countRangeDays(dateFrom, dateTo) {
  return Math.floor((dateTo.getTime() - dateFrom.getTime()) / 86400000) + 1;
}

function listDateStrings(dateFrom, dateTo) {
  const dates = [];
  const current = new Date(dateFrom);
  while (current.getTime() <= dateTo.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function normalizeWorkflowNames(workflowName) {
  if (!workflowName) {
    return [];
  }

  const names = String(workflowName)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unsupported = names.filter((name) => !DASHBOARD_WORKFLOWS.includes(name));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported workflowName filter: ${unsupported.join(", ")}`);
  }

  return names;
}

function resolveDashboardFilters({
  dateFrom,
  dateTo,
  month,
  workflowName,
  category,
  status,
  actionDecision,
  includeRecords,
  today = new Date(),
} = {}) {
  if (month && (dateFrom || dateTo)) {
    throw new Error("Use either month or dateFrom/dateTo, not both");
  }

  let from;
  let to;
  if (month) {
    const monthKey = String(month).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new Error(`Invalid month: ${month}`);
    }
    from = parseDateOnly(`${monthKey}-01`, "month");
    to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
  } else if (dateFrom || dateTo) {
    if (!dateFrom || !dateTo) {
      throw new Error("Both dateFrom and dateTo are required");
    }
    from = parseDateOnly(dateFrom, "dateFrom");
    to = parseDateOnly(dateTo, "dateTo");
  } else {
    to = parseDateOnly(today.toISOString(), "today");
    from = addDays(to, -(DEFAULT_DASHBOARD_RANGE_DAYS - 1));
  }

  if (from.getTime() > to.getTime()) {
    throw new Error("dateFrom must be on or before dateTo");
  }

  const rangeDays = countRangeDays(from, to);
  if (rangeDays > MAX_DASHBOARD_RANGE_DAYS) {
    throw new Error(`Dashboard date range cannot exceed ${MAX_DASHBOARD_RANGE_DAYS} days`);
  }

  const workflowNames = normalizeWorkflowNames(workflowName);
  const normalizedCategory = category ? String(category).trim().toLowerCase() : null;
  const normalizedStatus = status ? String(status).trim().toLowerCase() : null;
  const normalizedActionDecision = actionDecision
    ? String(actionDecision).trim().toLowerCase()
    : null;

  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    month: month ? String(month).slice(0, 7) : null,
    workflowNames,
    category: normalizedCategory,
    status: normalizedStatus,
    actionDecision: normalizedActionDecision,
    includeRecords: Boolean(includeRecords),
    rangeDays,
  };
}

function getWorkflowCategory(workflowName) {
  return WORKFLOW_CATEGORIES[workflowName] || "other";
}

function buildWorkflowCatalog() {
  return DASHBOARD_WORKFLOWS.map((workflowName) => ({
    workflowName,
    ...getWorkflowMetadata(workflowName),
    category: getWorkflowCategory(workflowName),
    sendsEmail: DASHBOARD_EMAIL_WORKFLOWS.includes(workflowName),
  }));
}

function sumCountMap(records, propertyName) {
  return records.reduce((total, record) => {
    for (const [key, value] of Object.entries(record[propertyName] || {})) {
      total[key] = Number(total[key] || 0) + Number(value || 0);
    }
    return total;
  }, {});
}

function sortCountMap(map, limit = 10) {
  return Object.entries(map || {})
    .map(([key, count]) => ({ key, count: Number(count || 0) }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    .slice(0, limit);
}

function buildEmptyTotals() {
  return {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    comparisonRecordCount: 0,
    updatedCount: 0,
    wouldUpdateCount: 0,
    sentEmailCount: 0,
    wouldSendEmailCount: 0,
    totalEmailCount: 0,
    skippedActionCount: 0,
    fieldChangeCount: 0,
  };
}

function addRecordToTotals(totals, record) {
  for (const key of Object.keys(totals)) {
    totals[key] += Number(record[key] || 0);
  }
  return totals;
}

function filterMetricRecords(records, filters) {
  return records.filter((record) => {
    if (filters.workflowNames.length > 0 && !filters.workflowNames.includes(record.workflowName)) {
      return false;
    }
    if (filters.category && getWorkflowCategory(record.workflowName) !== filters.category) {
      return false;
    }
    if (filters.status && record.lastRunStatus !== filters.status) {
      return false;
    }
    if (
      filters.actionDecision &&
      Number(record.actionDecisionCounts?.[filters.actionDecision] || 0) === 0
    ) {
      return false;
    }
    return true;
  });
}

function buildWorkflowSummary(records) {
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.workflowName)) {
      grouped.set(record.workflowName, []);
    }
    grouped.get(record.workflowName).push(record);
  }

  return Array.from(grouped.entries())
    .map(([workflowName, workflowRecords]) => {
      const totals = workflowRecords.reduce(addRecordToTotals, buildEmptyTotals());
      const latest = workflowRecords.reduce((currentLatest, record) => {
        if (!currentLatest || String(record.lastRunAt || "") > String(currentLatest.lastRunAt || "")) {
          return record;
        }
        return currentLatest;
      }, null);

      return {
        workflowName,
        ...getWorkflowMetadata(workflowName),
        category: getWorkflowCategory(workflowName),
        sendsEmail: DASHBOARD_EMAIL_WORKFLOWS.includes(workflowName),
        totals,
        lastRunAt: latest?.lastRunAt || null,
        lastRunStatus: latest?.lastRunStatus || null,
        lastSummary: latest?.lastSummary || null,
        artifactPath: latest?.artifactPath || null,
        topSkipReasons: sortCountMap(sumCountMap(workflowRecords, "skipReasonCounts"), 5),
        topActionDecisions: sortCountMap(sumCountMap(workflowRecords, "actionDecisionCounts"), 5),
      };
    })
    .sort((left, right) => left.workflowName.localeCompare(right.workflowName));
}

function buildDateSeries(records, filters) {
  const byDate = new Map(listDateStrings(parseDateOnly(filters.dateFrom), parseDateOnly(filters.dateTo)).map(
    (date) => [date, buildEmptyTotals()],
  ));

  for (const record of records) {
    if (!byDate.has(record.runDate)) {
      byDate.set(record.runDate, buildEmptyTotals());
    }
    addRecordToTotals(byDate.get(record.runDate), record);
  }

  return Array.from(byDate.entries()).map(([runDate, totals]) => ({
    runDate,
    totals,
  }));
}

function buildDashboardSummary({ records, filters, environment }) {
  const filteredRecords = filterMetricRecords(records, filters);
  const totals = filteredRecords.reduce(addRecordToTotals, buildEmptyTotals());

  return {
    generatedAt: new Date().toISOString(),
    environment,
    filters,
    totals: {
      ...totals,
      workflowCount: new Set(filteredRecords.map((record) => record.workflowName)).size,
      recordCount: filteredRecords.length,
    },
    workflows: buildWorkflowSummary(filteredRecords),
    trends: buildDateSeries(filteredRecords, filters),
    topSkipReasons: sortCountMap(sumCountMap(filteredRecords, "skipReasonCounts"), 10),
    topActionDecisions: sortCountMap(sumCountMap(filteredRecords, "actionDecisionCounts"), 10),
    topFieldsChanged: sortCountMap(sumCountMap(filteredRecords, "fieldCounts"), 10),
    topEntityTypes: sortCountMap(sumCountMap(filteredRecords, "entityTypeCounts"), 10),
    ...(filters.includeRecords ? { records: filteredRecords } : {}),
  };
}

function buildEmailSummary({ records, filters, environment }) {
  const emailRecords = filterMetricRecords(records, filters).filter((record) =>
    DASHBOARD_EMAIL_WORKFLOWS.includes(record.workflowName),
  );
  const totals = emailRecords.reduce(addRecordToTotals, buildEmptyTotals());

  return {
    generatedAt: new Date().toISOString(),
    environment,
    filters,
    totals: {
      workflowCount: new Set(emailRecords.map((record) => record.workflowName)).size,
      totalEmails: totals.totalEmailCount,
      sentEmail: totals.sentEmailCount,
      wouldSendEmail: totals.wouldSendEmailCount,
      skippedActionCount: totals.skippedActionCount,
    },
    workflows: buildWorkflowSummary(emailRecords),
    trends: buildDateSeries(emailRecords, filters),
    topSkipReasons: sortCountMap(sumCountMap(emailRecords, "skipReasonCounts"), 10),
    ...(filters.includeRecords ? { records: emailRecords } : {}),
  };
}

function buildSkipSummary({ records, filters, environment }) {
  const filteredRecords = filterMetricRecords(records, filters);

  return {
    generatedAt: new Date().toISOString(),
    environment,
    filters,
    totals: {
      skippedCount: filteredRecords.reduce(
        (total, record) => total + Number(record.skippedCount || 0),
        0,
      ),
      skippedActionCount: filteredRecords.reduce(
        (total, record) => total + Number(record.skippedActionCount || 0),
        0,
      ),
    },
    skipReasons: sortCountMap(sumCountMap(filteredRecords, "skipReasonCounts"), 25),
    workflows: buildWorkflowSummary(filteredRecords).filter(
      (workflow) => workflow.totals.skippedCount > 0 || workflow.totals.skippedActionCount > 0,
    ),
  };
}

function buildAiMetricsContext({ summary }) {
  return {
    generatedAt: summary.generatedAt,
    environment: summary.environment,
    filters: {
      dateFrom: summary.filters.dateFrom,
      dateTo: summary.filters.dateTo,
      workflowNames: summary.filters.workflowNames,
      category: summary.filters.category,
      status: summary.filters.status,
    },
    totals: summary.totals,
    workflows: summary.workflows.map((workflow) => ({
      workflowName: workflow.workflowName,
      label: workflow.label,
      description: workflow.description,
      category: workflow.category,
      sendsEmail: workflow.sendsEmail,
      totals: workflow.totals,
      lastRunAt: workflow.lastRunAt,
      lastRunStatus: workflow.lastRunStatus,
      lastSummary: workflow.lastSummary,
      topSkipReasons: workflow.topSkipReasons,
    })),
    topSkipReasons: summary.topSkipReasons,
    topActionDecisions: summary.topActionDecisions,
  };
}

module.exports = {
  MAX_DASHBOARD_RANGE_DAYS,
  WORKFLOW_CATEGORIES,
  WORKFLOW_METADATA,
  buildAiMetricsContext,
  buildDashboardSummary,
  buildEmailSummary,
  buildSkipSummary,
  buildWorkflowCatalog,
  filterMetricRecords,
  resolveDashboardFilters,
  sortCountMap,
};
