require("dotenv").config();

const { app } = require("@azure/functions");
const { run: runCandidateStateSync } = require("./src/index");
const { run: runPlacementStatusSync } = require("./src/placementStatusSync");
const { run: runPlacementTerminationEmailSync } = require("./src/placementTerminationEmailSync");
const { run: runPlacementStartReminderSync } = require("./src/placementStartReminderSync");
const { run: runClientCorporation360Sync } = require("./src/clientCorporation360Sync");
const { run: runClientCorporationKeyAccountSync } = require("./src/clientCorporationKeyAccountSync");
const {
  buildHttpErrorPayload,
  buildHttpSuccessPayload,
  serializeError,
} = require("./src/workflowRuntime");

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
];

function createTimerHandler(definition) {
  return async (_timer, context) => {
    context.log(`Running ${definition.logLabel}`);
    try {
      await definition.run();
    } catch (error) {
      context.error(serializeError(error), `${definition.logLabel} failed`);
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
      const result = await definition.run();
      const finishedAt = new Date().toISOString();

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
  app.timer(definition.functionName, {
    schedule: process.env[definition.scheduleEnv] || definition.defaultSchedule,
    handler: createTimerHandler(definition),
  });

  app.http(`${definition.functionName}Http`, {
    methods: ["POST"],
    authLevel: "function",
    route: definition.route,
    handler: createHttpHandler(definition),
  });
}
