require("dotenv").config();

const { app } = require("@azure/functions");
const { run: runCandidateStateSync } = require("./src/index");
const { run: runPlacementStatusSync } = require("./src/placementStatusSync");

const candidateSchedule = process.env.AZURE_CANDIDATE_SYNC_SCHEDULE || "0 0 2 * * *";
const placementSchedule = process.env.AZURE_PLACEMENT_STATUS_SYNC_SCHEDULE || "0 */5 * * * *";

app.timer("candidateStateSync", {
  schedule: candidateSchedule,
  handler: async (_timer, context) => {
    context.log("Running candidate state sync");
    await runCandidateStateSync();
  },
});

app.timer("placementStatusSync", {
  schedule: placementSchedule,
  handler: async (_timer, context) => {
    context.log("Running placement status sync");
    await runPlacementStatusSync();
  },
});
