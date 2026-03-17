require("dotenv").config();

const { app } = require("@azure/functions");
const { run: runCandidateStateSync } = require("./src/index");
const { run: runPlacementStatusSync } = require("./src/placementStatusSync");
const { run: runClientCorporation360Sync } = require("./src/clientCorporation360Sync");

const candidateSchedule = process.env.AZURE_CANDIDATE_SYNC_SCHEDULE || "0 0 2 * * *";
const placementSchedule = process.env.AZURE_PLACEMENT_STATUS_SYNC_SCHEDULE || "0 */5 * * * *";
const keyAccount360Schedule = process.env.AZURE_CORPORATION_360_SYNC_SCHEDULE || "0 */5 * * * *";

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

app.timer("clientCorporation360Sync", {
  schedule: keyAccount360Schedule,
  handler: async (_timer, context) => {
    context.log("Running client corporation 360 sync");
    await runClientCorporation360Sync();
  }
})
