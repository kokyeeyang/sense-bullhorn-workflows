require("dotenv").config();

const { app } = require("@azure/functions");
const { loadConfig } = require("./src/helpers/config");
const { logger } = require("./src/helpers/logger");
const { run: runCandidateStateSync } = require("./src/workflows/index");
const { run: runPlacementDatabaseEnrichmentSync } = require("./src/workflows/placementDatabaseEnrichmentSync");
const { run: runPlacementStatusSync } = require("./src/workflows/placementStatusSync");
const { run: runPlacementTerminationEmailSync } = require("./src/workflows/placementTerminationEmailSync");
const { run: runPlacementTerminationWorkflowsSync } = require("./src/workflows/placementTerminationWorkflowsSync");
const { run: runInterviewIllinoisEmailSync } = require("./src/workflows/interviewIllinoisEmailSync");
const { run: runNewJobIllinoisEmailSync } = require("./src/workflows/newJobIllinoisEmailSync");
const { run: runPlacementStartReminderSync } = require("./src/workflows/placementStartReminderSync");
const { run: runAmericasOnboardingNoticesSync } = require("./src/workflows/americasOnboardingNoticesSync");
const { run: runSoHowDidWeDoFeedbackSync } = require("./src/workflows/soHowDidWeDoFeedbackSync");
const { run: runStartDateApprovalReminderSync } = require("./src/workflows/startDateApprovalReminderSync");
const { run: runPlacementBenefitsReminderSync } = require("./src/workflows/placementBenefitsReminderSync");
const { run: runPlacementBenefitsReminderTestSend } = require("./src/workflows/placementBenefitsReminderTestSend");
const { run: runUsContractPerformanceCheckinSync } = require("./src/workflows/usContractPerformanceCheckinSync");
const { run: runHarassmentTrainingSync } = require("./src/workflows/harassmentTrainingSync");
const { handleHarassmentTrainingResponse } = require("./src/workflows/harassmentTrainingResponseHandler");
const {
  handleStartDateApprovalReminderResponse,
} = require("./src/workflows/startDateApprovalReminderResponseHandler");
const {
  handleAmericasOnboardingNoticesResponse,
} = require("./src/workflows/americasOnboardingNoticesResponseHandler");
const {
  handleSoHowDidWeDoFeedbackResponse,
} = require("./src/workflows/soHowDidWeDoFeedbackResponseHandler");
const { run: runPlacementYearlyFeeIncreaseSync } = require("./src/workflows/placementYearlyFeeIncreaseSync");
const { run: runPlacementYearlyFeeIncreaseTestSend } = require("./src/workflows/placementYearlyFeeIncreaseTestSend");
const { run: runDailyWorkflowSummary } = require("./src/workflows/dailyWorkflowSummary");
const { run: runDailyWorkflowComparisonSummary } = require("./src/workflows/dailyWorkflowComparisonSummary");
const { run: runDailyWorkflowEmailSummary } = require("./src/workflows/dailyWorkflowEmailSummary");
const { run: runClientContactDncSync } = require("./src/workflows/clientContactDncSync");
const { run: runClientCorporation360Sync } = require("./src/workflows/clientCorporation360Sync");
const { run: runClientCorporationKeyAccountSync } = require("./src/workflows/clientCorporationKeyAccountSync");
const { run: runWorkflowDashboardRetentionCleanup } = require("./src/workflows/workflowDashboardRetentionCleanup");
const {
  buildHttpErrorPayload,
  buildHttpSuccessPayload,
  serializeError,
} = require("./src/utils/workflowRuntime");
const { buildWorkflowComparisonRecords } = require("./src/utils/workflowComparisonRecords");
const { writeWorkflowDashboardMetricsSafe } = require("./src/stores/workflowDashboardStore");
const { buildWorkflowRunSummary } = require("./src/utils/workflowRunSummary");
const { writeWorkflowRunLogSafe } = require("./src/stores/workflowRunLogStore");

const config = loadConfig();

const workflowDefinitions = [
  {
    functionName: "candidateStateSync",
    workflowName: "candidate-state-sync",
    route: "workflows/candidate-state-sync",
    scheduleEnv: "AZURE_CANDIDATE_SYNC_SCHEDULE",
    logLabel: "candidate state sync",
    run: runCandidateStateSync,
    enableTimer: false,
  },
  {
    functionName: "placementDatabaseEnrichmentSync",
    workflowName: "placement-database-enrichment-sync",
    route: "workflows/placement-database-enrichment-sync",
    scheduleEnv: "AZURE_PLACEMENT_DATABASE_ENRICHMENT_SYNC_SCHEDULE",
    logLabel: "placement database enrichment sync",
    run: runPlacementDatabaseEnrichmentSync,
    enableTimer: false,
  },
  {
    functionName: "placementStatusSync",
    workflowName: "placement-status-sync",
    route: "workflows/placement-status-sync",
    scheduleEnv: "AZURE_PLACEMENT_STATUS_SYNC_SCHEDULE",
    logLabel: "placement status sync",
    run: runPlacementStatusSync,
    enableTimer: false,
  },
  {
    functionName: "placementTerminationEmailSync",
    workflowName: "placement-termination-email-sync",
    route: "workflows/placement-termination-email-sync",
    scheduleEnv: "AZURE_PLACEMENT_TERMINATION_EMAIL_SCHEDULE",
    logLabel: "placement termination email sync",
    run: runPlacementTerminationEmailSync,
    enableTimer: false,
  },
  {
    functionName: "placementTerminationWorkflowsSync",
    workflowName: "placement-termination-workflows-sync",
    route: "workflows/placement-termination-workflows-sync",
    scheduleEnv: "AZURE_PLACEMENT_TERMINATION_WORKFLOWS_SCHEDULE",
    defaultSchedule: "0 0 * * * *",
    logLabel: "placement termination workflows sync",
    run: ({ targetDate } = {}) => runPlacementTerminationWorkflowsSync({ targetDate }),
  },
  {
    functionName: "placementStartReminderSync",
    workflowName: "placement-start-reminder-sync",
    route: "workflows/placement-start-reminder-sync",
    scheduleEnv: "AZURE_PLACEMENT_START_REMINDER_SCHEDULE",
    logLabel: "placement start reminder sync",
    run: runPlacementStartReminderSync,
    enableTimer: false,
  },
  {
    functionName: "americasOnboardingNoticesSync",
    workflowName: "americas-onboarding-notices-sync",
    route: "workflows/americas-onboarding-notices-sync",
    scheduleEnv: "AZURE_AMERICAS_ONBOARDING_NOTICES_SCHEDULE",
    defaultSchedule: "0 0 * * * *",
    logLabel: "Americas onboarding notices sync",
    run: ({ targetDate } = {}) => runAmericasOnboardingNoticesSync({ targetDate }),
  },
  {
    functionName: "soHowDidWeDoFeedbackSync",
    workflowName: "so-how-did-we-do-feedback-sync",
    route: "workflows/so-how-did-we-do-feedback-sync",
    scheduleEnv: "AZURE_SO_HOW_DID_WE_DO_FEEDBACK_SCHEDULE",
    defaultSchedule: "0 0 11 * * *",
    logLabel: "SO How Did We Do feedback sync",
    run: ({ targetDate } = {}) => runSoHowDidWeDoFeedbackSync({ targetDate }),
  },
  {
    functionName: "startDateApprovalReminderSync",
    workflowName: "start-date-approval-reminder-sync",
    route: "workflows/start-date-approval-reminder-sync",
    scheduleEnv: "AZURE_START_DATE_APPROVAL_REMINDER_SCHEDULE",
    defaultSchedule: "0 0 * * * *",
    logLabel: "start date approval reminder sync",
    run: ({ targetDate } = {}) => runStartDateApprovalReminderSync({ targetDate }),
  },
  {
    functionName: "placementBenefitsReminderSync",
    workflowName: "placement-benefits-reminder-sync",
    route: "workflows/placement-benefits-reminder-sync",
    scheduleEnv: "AZURE_PLACEMENT_BENEFITS_REMINDER_SCHEDULE",
    defaultSchedule: "0 0 17 * * *",
    logLabel: "placement benefits reminder sync",
    run: ({ targetDate } = {}) => runPlacementBenefitsReminderSync({ targetDate }),
    enabled: false,
  },
  {
    functionName: "placementBenefitsReminderTestSend",
    workflowName: "placement-benefits-reminder-test-send",
    route: "workflows/placement-benefits-reminder-test-send",
    logLabel: "placement benefits reminder test send",
    run: runPlacementBenefitsReminderTestSend,
    enableTimer: false,
    enabled: false,
  },
  {
    functionName: "usContractPerformanceCheckinSync",
    workflowName: "us-contract-performance-checkin-sync",
    route: "workflows/us-contract-performance-checkin-sync",
    scheduleEnv: "AZURE_US_CONTRACT_PERFORMANCE_CHECKIN_SCHEDULE",
    defaultSchedule: "0 0 9 * * *",
    logLabel: "US contract performance check-in sync",
    run: ({ targetDate } = {}) => runUsContractPerformanceCheckinSync({ targetDate }),
  },
  {
    functionName: "harassmentTrainingSync",
    workflowName: "harassment-training-sync",
    route: "workflows/harassment-training-sync",
    scheduleEnv: "AZURE_HARASSMENT_TRAINING_SCHEDULE",
    defaultSchedule: "0 0 9 * * *",
    logLabel: "harassment training sync",
    run: ({ targetDate } = {}) => runHarassmentTrainingSync({ targetDate }),
  },
  {
    functionName: "placementYearlyFeeIncreaseSync",
    workflowName: "placement-yearly-fee-increase-sync",
    route: "workflows/placement-yearly-fee-increase-sync",
    scheduleEnv: "AZURE_PLACEMENT_YEARLY_FEE_INCREASE_SCHEDULE",
    logLabel: "placement yearly fee increase sync",
    run: runPlacementYearlyFeeIncreaseSync,
    enableTimer: false,
  },
  {
    functionName: "placementYearlyFeeIncreaseTestSend",
    workflowName: "placement-yearly-fee-increase-test-send",
    route: "workflows/placement-yearly-fee-increase-test-send",
    logLabel: "placement yearly fee increase test send",
    run: runPlacementYearlyFeeIncreaseTestSend,
    enableTimer: false,
  },
  {
    functionName: "interviewIllinoisEmailSync",
    workflowName: "interview-illinois-email-sync",
    route: "workflows/interview-illinois-email-sync",
    scheduleEnv: "AZURE_INTERVIEW_ILLINOIS_EMAIL_SCHEDULE",
    logLabel: "interview Illinois email sync",
    run: runInterviewIllinoisEmailSync,
    enableTimer: false,
  },
  {
    functionName: "newJobIllinoisEmailSync",
    workflowName: "new-job-illinois-email-sync",
    route: "workflows/new-job-illinois-email-sync",
    scheduleEnv: "AZURE_NEW_JOB_ILLINOIS_EMAIL_SCHEDULE",
    defaultSchedule: "0 0 7 * * *",
    logLabel: "new job Illinois email sync",
    run: runNewJobIllinoisEmailSync,
  },
  {
    functionName: "clientContactDncSync",
    workflowName: "client-contact-dnc-sync",
    route: "workflows/client-contact-dnc-sync",
    scheduleEnv: "AZURE_CLIENT_CONTACT_DNC_SYNC_SCHEDULE",
    logLabel: "client contact DNC sync",
    run: runClientContactDncSync,
    enableTimer: false,
  },
  {
    functionName: "clientCorporation360Sync",
    workflowName: "client-corporation-360-sync",
    route: "workflows/client-corporation-360-sync",
    scheduleEnv: "AZURE_CLIENT_CORPORATION_360_SYNC_SCHEDULE",
    logLabel: "client corporation 360 sync",
    run: runClientCorporation360Sync,
    enableTimer: false,
  },
  {
    functionName: "clientCorporationKeyAccountSync",
    workflowName: "client-corporation-key-account-sync",
    route: "workflows/client-corporation-key-account-sync",
    scheduleEnv: "AZURE_CLIENT_CORPORATION_KEY_ACCOUNT_SYNC_SCHEDULE",
    logLabel: "client corporation key account sync",
    run: runClientCorporationKeyAccountSync,
    enableTimer: false,
  },
  {
    functionName: "dailyWorkflowSummary",
    workflowName: "daily-workflow-summary",
    route: "workflows/daily-workflow-summary",
    scheduleEnv: "AZURE_DAILY_WORKFLOW_SUMMARY_SCHEDULE",
    defaultSchedule: "0 55 23 * * *",
    logLabel: "daily workflow summary",
    run: ({ targetDate } = {}) => runDailyWorkflowSummary({ targetDate }),
  },
  {
    functionName: "dailyWorkflowComparisonSummary",
    workflowName: "daily-workflow-comparison-summary",
    route: "workflows/daily-workflow-comparison-summary",
    scheduleEnv: "AZURE_DAILY_WORKFLOW_COMPARISON_SUMMARY_SCHEDULE",
    defaultSchedule: "0 50 23 * * *",
    logLabel: "daily workflow comparison summary",
    run: ({ targetDate, workflowName, dateFrom, dateTo, includeRecords } = {}) =>
      runDailyWorkflowComparisonSummary({
        targetDate,
        workflowName,
        dateFrom,
        dateTo,
        includeRecords,
      }),
  },
  {
    functionName: "dailyWorkflowEmailSummary",
    workflowName: "daily-workflow-email-summary",
    route: "workflows/daily-workflow-email-summary",
    logLabel: "daily workflow email summary",
    run: ({ targetDate, workflowName, includeRecords } = {}) =>
      runDailyWorkflowEmailSummary({ targetDate, workflowName, includeRecords }),
    enableTimer: false,
  },
  {
    functionName: "workflowDashboardRetentionCleanup",
    workflowName: "workflow-dashboard-retention-cleanup",
    route: "workflows/workflow-dashboard-retention-cleanup",
    scheduleEnv: "AZURE_WORKFLOW_RETENTION_CLEANUP_SCHEDULE",
    defaultSchedule: "0 45 23 * * *",
    logLabel: "workflow dashboard retention cleanup",
    run: runWorkflowDashboardRetentionCleanup,
  },
];

function createTimerHandler(definition) {
  return async (_timer, context) => {
    const startedAt = new Date().toISOString();
    context.log(`Running ${definition.logLabel}`);

    try {
      const result = await definition.run();
      const finishedAt = new Date().toISOString();
      const summary = buildWorkflowRunSummary({
        workflowName: definition.workflowName,
        result,
      });
      const comparisonRecords = buildWorkflowComparisonRecords({
        workflowName: definition.workflowName,
        result,
      });

      await writeWorkflowRunLogSafe({
        config,
        logger,
        workflowName: definition.workflowName,
        trigger: "timer",
        startedAt,
        finishedAt,
        status: "success",
        summary,
      });
      await writeWorkflowDashboardMetricsSafe({
        config,
        logger,
        workflowName: definition.workflowName,
        finishedAt,
        status: "success",
        summary,
        comparisonRecords,
      });
    } catch (error) {
      const finishedAt = new Date().toISOString();
      context.error(serializeError(error), `${definition.logLabel} failed`);

      await writeWorkflowRunLogSafe({
        config,
        logger,
        workflowName: definition.workflowName,
        trigger: "timer",
        startedAt,
        finishedAt,
        status: "failed",
        summary: buildWorkflowRunSummary({
          workflowName: definition.workflowName,
          error,
        }),
      });

      throw error;
    }
  };
}

function createHttpHandler(definition) {
  return async (request, context) => {
    const startedAt = new Date().toISOString();
    context.log(`HTTP trigger received for ${definition.logLabel}`, {
      method: request.method,
      url: request.url,
    });

    try {
      const targetDate = request.query.get("targetDate") || null;
      const workflowName = request.query.get("workflowName") || null;
      const dateFrom = request.query.get("dateFrom") || null;
      const dateTo = request.query.get("dateTo") || null;
      const candidateIds = request.query.get("candidateIds") || null;
      const includeRecords =
        ["true", "1", "yes", "y"].includes(
          String(request.query.get("includeRecords") || "")
            .trim()
            .toLowerCase(),
        );
      const result = await definition.run({
        targetDate,
        workflowName,
        dateFrom,
        dateTo,
        candidateIds,
        includeRecords,
      });
      const finishedAt = new Date().toISOString();
      const summary = buildWorkflowRunSummary({
        workflowName: definition.workflowName,
        result,
      });
      const comparisonRecords = buildWorkflowComparisonRecords({
        workflowName: definition.workflowName,
        result,
      });

      await writeWorkflowRunLogSafe({
        config,
        logger,
        workflowName: definition.workflowName,
        trigger: "http",
        startedAt,
        finishedAt,
        status: "success",
        summary,
      });
      await writeWorkflowDashboardMetricsSafe({
        config,
        logger,
        workflowName: definition.workflowName,
        finishedAt,
        status: "success",
        summary,
        comparisonRecords,
      });

      return {
        status: 200,
        jsonBody: buildHttpSuccessPayload({
          workflowName: definition.workflowName,
          result,
          trigger: "http",
          startedAt,
          finishedAt,
        }),
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      context.error(serializeError(error), `${definition.logLabel} failed`);

      await writeWorkflowRunLogSafe({
        config,
        logger,
        workflowName: definition.workflowName,
        trigger: "http",
        startedAt,
        finishedAt,
        status: "failed",
        summary: buildWorkflowRunSummary({
          workflowName: definition.workflowName,
          error,
        }),
      });

      return {
        status: error.response?.status || 500,
        jsonBody: buildHttpErrorPayload({
          workflowName: definition.workflowName,
          error,
          trigger: "http",
          startedAt,
          finishedAt,
        }),
      };
    }
  };
}

for (const definition of workflowDefinitions) {
  if (definition.enabled === false) {
    continue;
  }

  if (definition.enableTimer !== false) {
    app.timer(definition.functionName, {
      schedule: process.env[definition.scheduleEnv] || definition.defaultSchedule,
      handler: createTimerHandler(definition),
    });
  }

  app.http(`${definition.functionName}Http`, {
    methods: ["POST"],
    authLevel: "function",
    route: definition.route,
    handler: createHttpHandler(definition),
  });
}

app.http("harassmentTrainingResponse", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "workflows/harassment-training/respond",
  handler: handleHarassmentTrainingResponse,
});

app.http("startDateApprovalReminderResponse", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "workflows/start-date-approval-reminder/respond",
  handler: handleStartDateApprovalReminderResponse,
});

app.http("americasOnboardingNoticesResponse", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "workflows/americas-onboarding-notices/respond",
  handler: handleAmericasOnboardingNoticesResponse,
});

app.http("soHowDidWeDoFeedbackResponse", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "workflows/so-how-did-we-do/respond",
  handler: handleSoHowDidWeDoFeedbackResponse,
});
