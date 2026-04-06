# sense-bullhorn-workflows
Completed Sense workflows:
1. Data Cleanup Journeys
2. Data Cleanup States
3. Data Enrichment Automations
4. New Jobs Illinois
5. Placement End Date Reminder
6. Placement Terminated Reminder
7. Start Date reminders

Minimal Node.js workflow to:

1. Authenticate to Bullhorn.
2. Search recently added candidates (`dateAdded` window).
3. Read candidate phone numbers (`phone`, `mobile`, `phone2`, `phone3`).
4. Infer region from phone number:
   - `+1` numbers use US area code (example: `515` -> `IA`).
   - Non-US normalization uses `address.countryID` mapping (example: `2291` -> `MY` / `Malaysia`).
5. Update Bullhorn candidate address:
   - US number -> update `address.state`
   - Non-US candidate -> update `address.countryCode` and `address.countryName` from `address.countryID`

This repo also includes a second automation for placement status transitions:

1. Subscribe to Bullhorn `Placement` update events.
2. Consume recent events from Bullhorn event subscriptions.
3. Confirm the exact status transition was `qc approved -> approved`.
4. Update the related candidate:
   - `companyName` -> placement `clientCorporation.name`
   - `occupation` -> placement `jobOrder.title`
   - `status` -> `Placed by us`
   - `dateAvailable` -> `dateEnd + 1 day`
   - `hourlyRateLow` -> placement `payRate`

It also includes a placement database enrichment automation:

1. Query `PlacementEditHistory` records created on the previous UTC day.
2. Keep only status changes where `newValue = approved` and `oldValue` is `qc approved`, `submitted`, or null.
3. Fetch each related placement once.
4. For `employmentType` in `perm` or `contract to perm`, update the candidate only when `dateBegin` is today or later.
5. For all other employment types, skip placements whose status is `terminated`, `rejected`, `fall out`, or `temporarily suspended`.
6. Update the related candidate:
   - `companyName` -> placement `clientCorporation.name`
   - `occupation` -> placement `jobOrder.title`
   - `status` -> `Placed by us`
   - `dateAvailable` -> `dateEnd + 1 day` for non-perm placements
   - `hourlyRateLow` -> placement `payRate` for non-perm placements

It also includes a client corporation cleanup automation:

1. Search `ClientCorporation` records added on or after a cutoff date.
2. Wait until at least 24 hours have passed since `dateAdded`.
3. Keep only records where `customText7` is empty or null.
4. Exclude records whose `name` starts with a blocked prefix list.
5. Update `customText7` to `360`.

It also includes a client corporation key account cleanup automation:

1. Search `ClientCorporation` records added on or after a cutoff date.
2. Wait until at least 24 hours have passed since `dateAdded`.
3. Keep only records where `customText7` is empty or null.
4. Include only records whose `name` starts with the listed prefix list.
5. Update `customText7` to `Key Account`.

It also includes a placement start reminder automation:

1. Query `Placement` records where `dateBegin` falls on the UTC day exactly N days ahead.
2. Expand nested placement fields for candidate, client corporation, billing contact, and job order owner.
3. Fetch the candidate to get `owner.id`.
4. Fetch the owner `CorporateUser` to get the recipient email address.
5. Transform each placement into one SparkPost recipient with template substitution data.
6. Send one SparkPost transmission containing all recipients, or write dry-run preview reports when `DRY_RUN=true`.

It also includes a placement termination email automation:

1. Subscribe to Bullhorn `Placement` update events with a dedicated subscription queue.
2. Consume recent events from Bullhorn on a schedule.
3. Confirm the exact placement status `newValue` is `terminated`.
4. Fetch the related placement, candidate, and candidate owner.
5. Transform each matched placement into one SparkPost recipient for the owner.
6. Send one SparkPost transmission containing all recipients, or write dry-run preview reports when `DRY_RUN=true`.

It also includes an Illinois interview notification automation:

1. Subscribe to Bullhorn `Appointment` insert events with a dedicated subscription queue.
2. Consume recent appointment events from Bullhorn on a schedule.
3. Keep only appointments where `type = Interview`.
4. Filter the related `jobOrder` to `address.state = Illinois`, `dateAdded = 2024-05-01`, and `employmentType = contract`.
5. Fetch the job order owner and send one SparkPost email per matching interview.
6. Send one SparkPost transmission containing all recipients, or write dry-run preview reports when `DRY_RUN=true`.

## Important security note

The credentials shared in chat should be treated as compromised. Rotate all Bullhorn `client_secret`, user password, access tokens, and any related secrets before using this in production.

## Local run

1. Copy `.env.example` to `.env`.
2. Fill in your Bullhorn values.
3. Run:

```bash
npm ci
npm run run:workflow
npm run run:placement-database-enrichment-sync
npm run run:placement-status-sync
npm run run:placement-termination-email-sync
npm run run:interview-illinois-email-test-send
npm run run:interview-illinois-email-sync
npm run run:placement-start-reminder-sync
npm run run:client-corporation-360-sync
npm run run:client-corporation-key-account-sync
```

`DRY_RUN=true` logs intended updates without writing to Bullhorn, including a simulated post-update candidate object preview.
`TEST_CANDIDATE_ID=2923234` restricts the run to exactly one candidate by id.
Each run writes `reports/changes-report-<timestamp>.json` with all affected candidates and field-level changes.
Placement start reminder runs write both `reports/placement-start-reminder-report-<timestamp>.json` and `reports/placement-start-reminder-sparkpost-payload-<timestamp>.json`.
Placement termination email runs write both `reports/placement-termination-email-report-<timestamp>.json` and `reports/placement-termination-email-sparkpost-payload-<timestamp>.json`.
Illinois interview email runs write both `reports/interview-illinois-email-report-<timestamp>.json` and `reports/interview-illinois-email-sparkpost-payload-<timestamp>.json`.
Illinois interview test sends write `reports/interview-illinois-email-sparkpost-test-payload-<timestamp>.json`.

## Required environment variables

- `BULLHORN_ENV` (`staging` or `production`; default: `production`)
- `BULLHORN_AUTH_BASE_URL`
- `BULLHORN_REDIRECT_URI`
- `BULLHORN_<ENV>_CLIENT_ID`
- `BULLHORN_<ENV>_CLIENT_SECRET`
- `BULLHORN_<ENV>_USERNAME`
- `BULLHORN_<ENV>_PASSWORD`

Optional:

- `BULLHORN_<ENV>_API_BASE_URL` (if your login endpoint differs)
- `BULLHORN_<ENV>_API_VERSION` (default: `*`)
- `LOOKBACK_HOURS` (default: `60`)
- `CLIENT_CORPORATION_360_CUTOFF_DATE` (default: `2023-12-01`)
- `CLIENT_CORPORATION_360_DELAY_HOURS` (default: `24`)
- `CLIENT_CORPORATION_KEY_ACCOUNT_CUTOFF_DATE` (default: `2024-01-01`)
- `CLIENT_CORPORATION_KEY_ACCOUNT_DELAY_HOURS` (default: `24`)
- `DRY_RUN` (default: `true`)
- `TEST_CANDIDATE_ID` (optional; when set, query uses `id:<value>` instead of `dateAdded`)
- `TEST_CLIENT_CORPORATION_ID` (optional; when set, query uses `id:<value>` instead of the cutoff date search)
- `PLACEMENT_EVENT_SUBSCRIPTION_ID` (default: `sense-placement-status-sync`)
- `PLACEMENT_EVENT_MAX_EVENTS` (default: `100`)
- `PLACEMENT_DATABASE_ENRICHMENT_QUERY_COUNT` (default: `200`)
- `PLACEMENT_DATABASE_ENRICHMENT_DAYS_BACK` (default: `1`; previous UTC day by default)
- `PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID` (default: `sense-placement-termination-email`)
- `PLACEMENT_TERMINATION_EVENT_MAX_EVENTS` (default: `100`)
- `INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID` (default: `sense-interview-illinois-email`)
- `INTERVIEW_ILLINOIS_EVENT_MAX_EVENTS` (default: `100`)
- `INTERVIEW_ILLINOIS_JOB_ORDER_STATE` (default: `Illinois`)
- `INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED` (default: `2024-05-01`)
- `INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE` (default: `contract`)
- `PLACEMENT_START_REMINDER_DAYS_AHEAD` (default: `4`)
- `PLACEMENT_START_REMINDER_QUERY_COUNT` (default: `200`)
- `PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS` (default: `0`; expands the query window backward for testing)
- `PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS` (default: `0`; expands the query window forward for testing)
- `BULLHORN_<ENV>_PLACEMENT_START_REMINDER_DAYS_AHEAD` (optional env-specific override)
- `BULLHORN_<ENV>_PLACEMENT_START_REMINDER_QUERY_COUNT` (optional env-specific override)
- `BULLHORN_<ENV>_PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS` (optional env-specific override)
- `BULLHORN_<ENV>_PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS` (optional env-specific override)
- `SPARKPOST_API_BASE_URL` (default: `https://api.sparkpost.com`)
- `SPARKPOST_API_KEY` (required when `DRY_RUN=false`)
- `SPARKPOST_TEMPLATE_ID` (required when `DRY_RUN=false`)
- `INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID` (optional; falls back to `SPARKPOST_TEMPLATE_ID`)
- `PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID` (optional; falls back to `SPARKPOST_TEMPLATE_ID`)
- `RETRY_MAX_ATTEMPTS` (default: `4`; retries on `429` and `5xx`)
- `RETRY_BASE_DELAY_MS` (default: `500`; exponential backoff base delay)
- `UPDATE_DELAY_MS` (default: `150`; delay between live update calls)

## GitHub Actions

Workflow file: `.github/workflows/bullhorn-state-sync.yml`

- Scheduled daily at `02:00 UTC` (10:00 AM Malaysia time, UTC+8).
- Can also run manually with `workflow_dispatch`.
- Uploads `reports/*.json` as a workflow artifact (`bullhorn-changes-report`).

Workflow file: `.github/workflows/bullhorn-placement-status-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uses Bullhorn event subscriptions for `Placement UPDATED`.
- Uploads `reports/placement-status-report-*.json` as a workflow artifact (`bullhorn-placement-status-report`).

Workflow file: `.github/workflows/bullhorn-placement-database-enrichment-sync.yml`

- Scheduled daily at `00:01 UTC`.
- Can also run manually with `workflow_dispatch`.
- Queries `PlacementEditHistory` for the previous UTC day instead of consuming live events.
- Uploads `reports/placement-database-enrichment-report-*.json` as a workflow artifact (`bullhorn-placement-database-enrichment-report`).

Workflow file: `.github/workflows/bullhorn-placement-termination-email-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uses a dedicated Bullhorn event subscription queue for `Placement UPDATED`.
- Filters the consumed events to status changes where the new value is `terminated`.
- Uploads both `reports/placement-termination-email-report-*.json` and `reports/placement-termination-email-sparkpost-payload-*.json` as a workflow artifact (`bullhorn-placement-termination-email-reports`).

Workflow file: `.github/workflows/bullhorn-interview-illinois-email-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uses a dedicated Bullhorn event subscription queue for `Appointment INSERTED`.
- Filters the consumed appointments to `type = Interview` and the configured Illinois job order conditions.
- Uploads both `reports/interview-illinois-email-report-*.json` and `reports/interview-illinois-email-sparkpost-payload-*.json` as a workflow artifact (`bullhorn-interview-illinois-email-reports`).

Workflow file: `.github/workflows/bullhorn-client-corporation-360-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uploads `reports/client-corporation-360-report-*.json` as a workflow artifact (`bullhorn-client-corporation-360-report`).

Workflow file: `.github/workflows/bullhorn-client-corporation-key-account-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uploads `reports/client-corporation-key-account-report-*.json` as a workflow artifact (`bullhorn-client-corporation-key-account-report`).

Workflow file: `.github/workflows/bullhorn-placement-start-reminder-sync.yml`

- Scheduled daily at `00:00 UTC`.
- Can also run manually with `workflow_dispatch`.
- Uploads both `reports/placement-start-reminder-report-*.json` and `reports/placement-start-reminder-sparkpost-payload-*.json` as a workflow artifact (`bullhorn-placement-start-reminder-reports`).

Add repository secrets with the same names as the env vars above.

Example `.env`:

```env
BULLHORN_ENV=staging

BULLHORN_AUTH_BASE_URL=https://rest-west9.bullhornstaffing.com
BULLHORN_REDIRECT_URI=http://api-oauth2.northeurope.cloudapp.azure.com

BULLHORN_STAGING_CLIENT_ID=your-staging-client-id
BULLHORN_STAGING_CLIENT_SECRET=your-staging-client-secret
BULLHORN_STAGING_USERNAME=your-staging-username
BULLHORN_STAGING_PASSWORD=your-staging-password
BULLHORN_STAGING_API_BASE_URL=https://rest29.bullhornstaffing.com
BULLHORN_STAGING_API_VERSION=*

BULLHORN_PRODUCTION_CLIENT_ID=your-production-client-id
BULLHORN_PRODUCTION_CLIENT_SECRET=your-production-client-secret
BULLHORN_PRODUCTION_USERNAME=your-production-username
BULLHORN_PRODUCTION_PASSWORD=your-production-password
BULLHORN_PRODUCTION_API_BASE_URL=
BULLHORN_PRODUCTION_API_VERSION=*

BULLHORN_STAGING_PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS=730
BULLHORN_STAGING_PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS=730
BULLHORN_PRODUCTION_PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS=0
BULLHORN_PRODUCTION_PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS=0
```

`BULLHORN_AUTH_BASE_URL` and `BULLHORN_REDIRECT_URI` can stay shared across environments. If you ever need to override them per environment later, the prefixed fallback keys still work.

The placement start reminder settings can also be overridden per environment. A common setup is broad windows in staging for limited data and `0/0` in production so reminders only send for placements starting exactly the configured number of days ahead.

All workflows call the same `loadConfig()` function, so switching `BULLHORN_ENV` changes the active Bullhorn environment everywhere without further code changes.

## Azure Functions

Cheapest practical setup:

- 1 Azure Function App on the `Consumption` plan
- 1 Storage Account
- 1 Application Insights resource with conservative retention

This repo supports Azure Functions and GitHub Actions side by side:

- GitHub Actions continues using `npm run run:workflow` and `npm run run:placement-status-sync`
- GitHub Actions can also use `npm run run:placement-database-enrichment-sync`
- Azure Functions uses `functionApp.js` timer triggers that call the same exported `run()` functions

Azure schedules:

- `AZURE_CANDIDATE_SYNC_SCHEDULE` default: `0 0 2 * * *`
- `AZURE_PLACEMENT_DATABASE_ENRICHMENT_SYNC_SCHEDULE` default: `0 1 0 * * *`
- `AZURE_PLACEMENT_STATUS_SYNC_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_PLACEMENT_TERMINATION_EMAIL_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_INTERVIEW_ILLINOIS_EMAIL_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_PLACEMENT_START_REMINDER_SCHEDULE` default: `0 0 0 * * *`
- `AZURE_CLIENT_CORPORATION_360_SYNC_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_CLIENT_CORPORATION_KEY_ACCOUNT_SYNC_SCHEDULE` default: `0 */5 * * * *`

## Azure Functions + Logic Apps

Recommended split for this repo:

- Azure Functions owns the Bullhorn workflow logic and SparkPost integrations.
- Logic Apps calls HTTP-triggered Functions for orchestration, visibility, approvals, and notifications.

The same workflow can now be run three ways:

- locally through `npm run ...`
- on a schedule through Azure timer-triggered Functions
- from Logic Apps through HTTP-triggered Functions

### Logic App call pattern

Each workflow has an HTTP-triggered Function with `authLevel: "function"`, so Logic Apps should call it with `POST` and include the Function key.

Routes:

- `POST /api/workflows/candidate-state-sync`
- `POST /api/workflows/placement-database-enrichment-sync`
- `POST /api/workflows/placement-status-sync`
- `POST /api/workflows/placement-termination-email-sync`
- `POST /api/workflows/interview-illinois-email-sync`
- `POST /api/workflows/placement-start-reminder-sync`
- `POST /api/workflows/client-corporation-360-sync`
- `POST /api/workflows/client-corporation-key-account-sync`

Example full URL:

```text
https://<your-function-app>.azurewebsites.net/api/workflows/client-corporation-360-sync?code=<function-key>
```

Logic Apps does not need to know how to run `npm` scripts. It only needs the correct Function endpoint for the workflow it wants to invoke.

### HTTP response shape

Each HTTP-triggered Function returns a structured JSON response that Logic Apps can use for run history, notifications, and branching.

Success example:

```json
{
  "workflow": "client-corporation-360-sync",
  "status": "success",
  "trigger": "http",
  "startedAt": "2026-04-01T02:00:00.000Z",
  "finishedAt": "2026-04-01T02:00:07.000Z",
  "dryRun": true,
  "totals": {
    "totalClientCorporations": 42,
    "affectedClientCorporations": 5,
    "updated": 5,
    "skippedExcludedName": 20,
    "skippedDelayNotMet": 10,
    "skippedNoPatch": 4,
    "skippedNoChange": 3
  },
  "artifacts": {
    "reportPath": "/home/site/wwwroot/reports/client-corporation-360-report-2026-04-01T02-00-07-000Z.json"
  },
  "report": {
    "generatedAt": "2026-04-01T02:00:07.000Z",
    "dryRun": true,
    "totals": {
      "totalClientCorporations": 42,
      "affectedClientCorporations": 5,
      "updated": 5,
      "skippedExcludedName": 20,
      "skippedDelayNotMet": 10,
      "skippedNoPatch": 4,
      "skippedNoChange": 3
    }
  }
}
```

Error example:

```json
{
  "workflow": "client-corporation-360-sync",
  "status": "error",
  "trigger": "http",
  "startedAt": "2026-04-01T02:00:00.000Z",
  "finishedAt": "2026-04-01T02:00:02.000Z",
  "error": {
    "message": "Invalid environment config",
    "stack": "...",
    "responseStatus": null,
    "responseData": null
  }
}
```

### Reporting guidance

- Local runs and GitHub Actions can keep using the `reports/` folder as they do today.
- Azure Functions can still write to `reports/`, but that filesystem is temporary.
- For Logic Apps, treat the HTTP response as the primary summary.
- If you later need durable reports in Azure, store them in Blob Storage and return the blob URL in the Function response.

Azure local/dev setup:

1. Copy `local.settings.example.json` to `local.settings.json`
2. Fill in Bullhorn settings
3. Install Azure Functions Core Tools locally
4. Run `npm ci`
5. Run `npm run start:azure`

Notes:

- Azure timer schedules use NCRONTAB with a seconds field
- `AzureWebJobsStorage` is required by Azure Functions even though your workflow logic is external to Azure
- Reports still write to the local `reports/` folder for GitHub Actions and local runs; on Azure that filesystem is temporary, so prefer the HTTP summary response for Logic Apps and add Blob Storage later if you need durable report artifacts

## Files

- `src/index.js`: Main runner.
- `src/placementDatabaseEnrichmentSync.js`: Daily placement database enrichment runner.
- `src/placementStatusSync.js`: Placement status transition runner.
- `src/placementTerminationEmailSync.js`: Placement termination email runner.
- `src/interviewIllinoisEmailSync.js`: Illinois interview notification runner.
- `src/placementStartReminderSync.js`: Placement start reminder enrichment runner.
- `src/placementStartReminderUtils.js`: Placement reminder substitution and formatting helpers.
- `src/placementTerminationEmailUtils.js`: Placement termination email helpers.
- `src/interviewIllinoisEmailUtils.js`: Illinois interview filter and substitution helpers.
- `src/sparkPostClient.js`: SparkPost transmission client.
- `src/clientCorporation360Sync.js`: Client corporation `customText7 -> 360` cleanup runner.
- `src/clientCorporationKeyAccountSync.js`: Client corporation `customText7 -> Key Account` cleanup runner.
- `functionApp.js`: Azure Functions timer and HTTP entrypoints.
- `src/workflowRuntime.js`: Shared workflow result, HTTP response, and JSON artifact helpers.
- `src/bullhornClient.js`: Bullhorn auth/search/update calls.
- `src/phoneUtils.js`: Phone parsing and mapping logic.
- `src/placementDatabaseEnrichmentUtils.js`: Placement database enrichment filters and patch helpers.
- `src/placementUtils.js`: Placement transition mapping helpers.
- `src/clientCorporation360Utils.js`: Client corporation cleanup filters and patch helpers.
- `src/clientCorporationKeyAccountUtils.js`: Client corporation key account cleanup filters and patch helpers.
- `src/areaCodeToState.js`: Area-code -> state map.
- `src/callingCodeToCountryId.js`: Calling-code -> countryID map.
- `src/countryIdToCountry.js`: CountryID -> `{ countryCode, countryName }` map.
