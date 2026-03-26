# sense-bullhorn-workflows

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
2. Extract each placement's `candidate.id`.
3. Fetch the candidate to get `owner.id`.
4. Fetch the owner `CorporateUser` to get the email address.
5. Build a report grouped by owner email, ready to map into a SparkPost transmission later.

## Important security note

The credentials shared in chat should be treated as compromised. Rotate all Bullhorn `client_secret`, user password, access tokens, and any related secrets before using this in production.

## Local run

1. Copy `.env.example` to `.env`.
2. Fill in your Bullhorn values.
3. Run:

```bash
npm ci
npm run run:workflow
npm run run:placement-status-sync
npm run run:placement-start-reminder-sync
npm run run:client-corporation-360-sync
npm run run:client-corporation-key-account-sync
```

`DRY_RUN=true` logs intended updates without writing to Bullhorn, including a simulated post-update candidate object preview.
`TEST_CANDIDATE_ID=2923234` restricts the run to exactly one candidate by id.
Each run writes `reports/changes-report-<timestamp>.json` with all affected candidates and field-level changes.

## Required environment variables

- `BULLHORN_CLIENT_ID`
- `BULLHORN_CLIENT_SECRET`
- `BULLHORN_USERNAME`
- `BULLHORN_PASSWORD`
- `BULLHORN_REDIRECT_URI`

Optional:

- `BULLHORN_AUTH_BASE_URL` (default: `https://rest.bullhornstaffing.com`)
- `BULLHORN_API_BASE_URL` (if your login endpoint differs)
- `BULLHORN_API_VERSION` (default: `*`)
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
- `PLACEMENT_START_REMINDER_DAYS_AHEAD` (default: `4`)
- `PLACEMENT_START_REMINDER_QUERY_COUNT` (default: `200`)
- `PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS` (default: `0`; expands the query window backward for testing)
- `PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS` (default: `0`; expands the query window forward for testing)
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
- Uploads `reports/placement-start-reminder-report-*.json` as a workflow artifact (`bullhorn-placement-start-reminder-report`).

Add repository secrets with the same names as the env vars above.

## Azure Functions

Cheapest practical setup:

- 1 Azure Function App on the `Consumption` plan
- 1 Storage Account
- 1 Application Insights resource with conservative retention

This repo supports Azure Functions and GitHub Actions side by side:

- GitHub Actions continues using `npm run run:workflow` and `npm run run:placement-status-sync`
- Azure Functions uses `functionApp.js` timer triggers that call the same exported `run()` functions

Azure schedules:

- `AZURE_CANDIDATE_SYNC_SCHEDULE` default: `0 0 2 * * *`
- `AZURE_PLACEMENT_STATUS_SYNC_SCHEDULE` default: `0 */5 * * * *`

Azure local/dev setup:

1. Copy `local.settings.example.json` to `local.settings.json`
2. Fill in Bullhorn settings
3. Install Azure Functions Core Tools locally
4. Run `npm ci`
5. Run `npm run start:azure`

Notes:

- Azure timer schedules use NCRONTAB with a seconds field
- `AzureWebJobsStorage` is required by Azure Functions even though your workflow logic is external to Azure
- Reports still write to the local `reports/` folder for GitHub Actions and local runs; on Azure that filesystem is temporary, so rely on logs unless you later add Blob Storage output

## Files

- `src/index.js`: Main runner.
- `src/placementStatusSync.js`: Placement status transition runner.
- `src/placementStartReminderSync.js`: Placement start reminder enrichment runner.
- `src/clientCorporation360Sync.js`: Client corporation `customText7 -> 360` cleanup runner.
- `src/clientCorporationKeyAccountSync.js`: Client corporation `customText7 -> Key Account` cleanup runner.
- `functionApp.js`: Azure Functions timer entrypoints.
- `src/bullhornClient.js`: Bullhorn auth/search/update calls.
- `src/phoneUtils.js`: Phone parsing and mapping logic.
- `src/placementUtils.js`: Placement transition mapping helpers.
- `src/clientCorporation360Utils.js`: Client corporation cleanup filters and patch helpers.
- `src/clientCorporationKeyAccountUtils.js`: Client corporation key account cleanup filters and patch helpers.
- `src/areaCodeToState.js`: Area-code -> state map.
- `src/callingCodeToCountryId.js`: Calling-code -> countryID map.
- `src/countryIdToCountry.js`: CountryID -> `{ countryCode, countryName }` map.
