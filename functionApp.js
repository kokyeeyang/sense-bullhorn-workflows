require("dotenv").config();

const { app } = require("@azure/functions");
const { loadConfig } = require("./src/config");
const { logger } = require("./src/logger");
const { run: runCandidateStateSync } = require("./src/index");
const { run: runPlacementDatabaseEnrichmentSync } = require("./src/placementDatabaseEnrichmentSync");
const { run: runPlacementStatusSync } = require("./src/placementStatusSync");
const { run: runPlacementTerminationEmailSync } = require("./src/placementTerminationEmailSync");
const { run: runInterviewIllinoisEmailSync } = require("./src/interviewIllinoisEmailSync");
const { run: runPlacementStartReminderSync } = require("./src/placementStartReminderSync");
const { run: runPlacementBenefitsReminderSync } = require("./src/placementBenefitsReminderSync");
const { run: runPlacementBenefitsReminderTestSend } = require("./src/placementBenefitsReminderTestSend");
const { run: runPlacementYearlyFeeIncreaseSync } = require("./src/placementYearlyFeeIncreaseSync");
const { run: runPlacementYearlyFeeIncreaseTestSend } = require("./src/placementYearlyFeeIncreaseTestSend");
const { run: runDailyWorkflowSummary } = require("./src/dailyWorkflowSummary");
const { run: runDailyWorkflowComparisonSummary } = require("./src/dailyWorkflowComparisonSummary");
const { run: runClientContactDncSync } = require("./src/clientContactDncSync");
const { run: runClientCorporation360Sync } = require("./src/clientCorporation360Sync");
const { run: runClientCorporationKeyAccountSync } = require("./src/clientCorporationKeyAccountSync");
const {
  buildHttpErrorPayload,
  buildHttpSuccessPayload,
  serializeError,
} = require("./src/workflowRuntime");
const { buildWorkflowComparisonRecords } = require("./src/workflowComparisonRecords");
const { writeWorkflowComparisonRecordsSafe } = require("./src/workflowComparisonStore");
const { buildWorkflowRunSummary } = require("./src/workflowRunSummary");
const { writeWorkflowRunLogSafe } = require("./src/workflowRunLogStore");

const config = loadConfig();

const workflowDefinitions = [
  {
    functionName: "candidateStateSync",
    workflowName: "candidate-state-sync",
    route: "workflows/candidate-state-sync",
    scheduleEnv: "AZURE_CANDIDATE_SYNC_SCHEDULE",
    defaultSchedule: "0 0 2 * * *",
    logLabel: "candidate state sync",
    run: runCandidateStateSync,
  },
  {
    functionName: "placementDatabaseEnrichmentSync",
    workflowName: "placement-database-enrichment-sync",
    route: "workflows/placement-database-enrichment-sync",
    scheduleEnv: "AZURE_PLACEMENT_DATABASE_ENRICHMENT_SYNC_SCHEDULE",
    defaultSchedule: "0 */5 * * * *",
    logLabel: "placement database enrichment sync",
    run: runPlacementDatabaseEnrichmentSync,
  },
  {
    functionName: "placementStatusSync",
    workflowName: "placement-status-sync",
    route: "workflows/placement-status-sync",
    scheduleEnv: "AZURE_PLACEMENT_STATUS_SYNC_SCHEDULE",
    defaultSchedule: "0 */5 * * * *",
    logLabel: "placement status sync",
    run: runPlacementStatusSync,
  },
  {
    functionName: "placementTerminationEmailSync",
    workflowName: "placement-termination-email-sync",
    route: "workflows/placement-termination-email-sync",
    scheduleEnv: "AZURE_PLACEMENT_TERMINATION_EMAIL_SCHEDULE",
    defaultSchedule: "0 */5 * * * *",
    logLabel: "placement termination email sync",
    run: runPlacementTerminationEmailSync,
  },
  {
    functionName: "placementStartReminderSync",
    workflowName: "placement-start-reminder-sync",
    route: "workflows/placement-start-reminder-sync",
    scheduleEnv: "AZURE_PLACEMENT_START_REMINDER_SCHEDULE",
    defaultSchedule: "0 0 0 * * *",
    logLabel: "placement start reminder sync",
    run: runPlacementStartReminderSync,
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
    functionName: "placementYearlyFeeIncreaseSync",
    workflowName: "placement-yearly-fee-increase-sync",
    route: "workflows/placement-yearly-fee-increase-sync",
    scheduleEnv: "AZURE_PLACEMENT_YEARLY_FEE_INCREASE_SCHEDULE",
    defaultSchedule: "0 0 0 * * *",
    logLabel: "placement yearly fee increase sync",
    run: runPlacementYearlyFeeIncreaseSync,
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
    defaultSchedule: "0 */5 * * * *",
    logLabel: "interview Illinois email sync",
    run: runInterviewIllinoisEmailSync,
  },
  {
    functionName: "clientContactDncSync",
    workflowName: "client-contact-dnc-sync",
    route: "workflows/client-contact-dnc-sync",
    scheduleEnv: "AZURE_CLIENT_CONTACT_DNC_SYNC_SCHEDULE",
    defaultSchedule: "0 */5 * * * *",
    logLabel: "client contact DNC sync",
    run: runClientContactDncSync,
  },
  {
    functionName: "clientCorporation360Sync",
    workflowName: "client-corporation-360-sync",
    route: "workflows/client-corporation-360-sync",
    scheduleEnv: "AZURE_CLIENT_CORPORATION_360_SYNC_SCHEDULE",
    defaultSchedule: "0 */5 * * * *",
    logLabel: "client corporation 360 sync",
    run: runClientCorporation360Sync,
  },
  {
    functionName: "clientCorporationKeyAccountSync",
    workflowName: "client-corporation-key-account-sync",
    route: "workflows/client-corporation-key-account-sync",
    scheduleEnv: "AZURE_CLIENT_CORPORATION_KEY_ACCOUNT_SYNC_SCHEDULE",
    defaultSchedule: "0 */5 * * * *",
    logLabel: "client corporation key account sync",
    run: runClientCorporationKeyAccountSync,
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
    run: ({ targetDate } = {}) => runDailyWorkflowComparisonSummary({ targetDate }),
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
      await writeWorkflowComparisonRecordsSafe({
        config,
        logger,
        records: comparisonRecords,
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
      await writeWorkflowComparisonRecordsSafe({
        config,
        logger,
        records: comparisonRecords,
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
