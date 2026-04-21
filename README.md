# sense-bullhorn-workflows
Completed Sense workflows:
1. Data Cleanup Journeys
2. Data Cleanup States
3. Data Enrichment Automations
4. New Jobs Illinois
5. Placement End Date Reminder
6. Placement Terminated Reminder
7. Start Date reminders
8. Key Accounts
9. Reminder for Yearly Fee Increase
10. Placement Benefits Reminder

Minimal Node.js workflow to:

1. Authenticate to Bullhorn.
2. Search recently added candidates (`dateAdded` window), but never before the configured candidate cutoff date.
3. Read candidate phone numbers (`phone`, `mobile`, `phone2`, `phone3`).
4. Infer region from phone number:
   - `+1` numbers use US area code (example: `515` -> `IA`).
   - Non-US normalization uses `address.countryID` mapping (example: `2291` -> `MY` / `Malaysia`).
5. Update Bullhorn candidate address:
   - US number -> update `address.state`
   - Non-US candidate -> update `address.countryCode` and `address.countryName` from `address.countryID`

For manual one-time cleanup runs, the HTTP endpoint accepts an explicit candidate `dateAdded`
window:

```text
POST /api/workflows/candidate-state-sync?dateFrom=2017-12-31&dateTo=2018-12-31
```

When both `dateFrom` and `dateTo` are supplied, the workflow uses that exact UTC date
window instead of `LOOKBACK_HOURS`, and it does not apply
`CANDIDATE_STATE_SYNC_CUTOFF_DATE`. Scheduled runs continue to use the normal rolling
lookback plus cutoff behavior.

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

1. Subscribe to Bullhorn `Placement` update events with a dedicated subscription queue.
2. Consume up to `PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS` events per run.
3. Fetch each related placement once, even if multiple events for the same placement arrive in the same batch.
4. For status-change events, inspect `PlacementEditHistory` for the event transaction and keep eligible approved transitions.
5. For `employmentType` in `perm` or `contract to perm`, update the candidate only when `dateBegin` is today or later.
6. For all other employment types, skip placements whose status is `terminated`, `rejected`, `fall out`, or `temporarily suspended`.
7. Update the related candidate:
   - `companyName` -> placement `clientCorporation.name`
   - `occupation` -> placement `jobOrder.title`
   - `status` -> `Placed by us`
   - `dateAvailable` -> `dateEnd + 1 day` for non-perm placements
   - `hourlyRateLow` -> placement `payRate` for non-perm placements

The placement database enrichment workflow is queue-based, not a full placement scan. There is no static placement `dateAdded` cutoff. The `PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS` setting limits the number of queued Bullhorn events consumed in a single run, not the total number that can ever be processed. With the Azure Functions default schedule of every 5 minutes, a backlog should drain over multiple runs as long as new events do not arrive faster than the workflow can consume them. If the queue regularly has more than 100 events per run, increase `PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS`, run the HTTP endpoint manually to drain the backlog, or shorten the schedule interval.

It also includes a client contact DNC automation:

1. Search `ClientContact` records added on or after a cutoff date.
2. Wait until at least 60 hours have passed since `contact.dateAdded` before enforcing the delayed new-contact rule.
3. For delayed new contacts, update the contact only when the related `clientCorporation.status = do not contact`, the contact is not already `do not contact`, and the contact name does not start with `..` or `****`.
4. Subscribe to `ClientCorporation` update events and consume status changes on a schedule.
5. When `clientCorporation.status` changes from `do not contact -> active`, update related contacts to `massMailOptOut = No` and `status = Active`.
6. When `clientCorporation.status` changes from blank -> `do not contact`, update related contacts to `massMailOptOut = Yes` and `status = do not contact`.
7. Event-driven updates also skip blocked contact names (`..`, `****`), and reactivation only applies to contacts currently in `do not contact`.

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

It also includes a placement yearly fee increase reminder automation:

1. Query `Placement` records where `dateBegin` falls on the UTC day exactly 11 months before today.
2. Keep only placements where `employmentType = contract`, `clientCorporation.customDate1` (`TOB Date`) is present, `clientCorporation.billingFrequency` (`Yearly Fee Increase`) is `1-10`, and `dateEnd` is after today.
3. Fetch the `jobOrder.owner` and use that owner as the email recipient.
4. Transform each matching placement into one SparkPost recipient with yearly-fee-increase substitution data.
5. Send one SparkPost transmission containing all recipients, or write dry-run preview reports when `DRY_RUN=true`.

It also includes a placement benefits reminder automation:

1. Run once per day and calculate the active business date in `America/Los_Angeles`.
2. For reminder stages `dateBegin + 10`, `+21`, and `+26`, compute the exact `dateBegin` values that are due today, including weekend shifts to the closest Friday or Monday.
3. Query only those exact `Placement.dateBegin` day windows.
4. Keep only placements where `employmentType = contract`, `status` contains `approved` or `qc approved`, `candidate.customText21 = Benefit Eligible`, the candidate owner department is not excluded, and the client corporation is not excluded.
5. Send the day-specific SparkPost template to the candidate, with job order owner and candidate owner CC'd for the later reminder stages.
6. Write both a reminder report and SparkPost payload report, or write dry-run preview reports when `DRY_RUN=true`.

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

It also includes a New Jobs Illinois email automation:

1. Run once per day from Azure Functions.
2. Query Bullhorn `JobOrder` records by `dateAdded`.
3. Use a delayed eligibility window instead of alerting immediately. By default, the workflow looks for jobs added between `now - 48 hours` and `now - 24 hours`.
4. Keep only job orders where `address.state = Illinois` and `employmentType = contract`.
5. Fetch the job order owner and send one SparkPost email per matching job order.
6. Send one SparkPost transmission containing all recipients, or write dry-run preview reports when `DRY_RUN=true`.

### New Jobs Illinois timing notes

The Azure Function timer for `newJobIllinoisEmailSync` uses `AZURE_NEW_JOB_ILLINOIS_EMAIL_SCHEDULE` when it is set. If it is not set, the code falls back to:

```text
0 0 7 * * *
```

With no `WEBSITE_TIME_ZONE` app setting, Azure Functions interprets that schedule as `07:00 UTC`, which is `15:00` Malaysia time. If `WEBSITE_TIME_ZONE` is set in Azure, the same schedule runs at `07:00` in that configured timezone instead.

The workflow also has a 24-hour grace period. With the default settings, a job created at `2026-04-15T12:04:44Z` is not eligible for the `2026-04-16T07:00:00Z` run because that run checks approximately:

```text
2026-04-14T07:00:00Z through 2026-04-15T07:00:00Z
```

The same job is eligible for the `2026-04-17T07:00:00Z` run because that run checks approximately:

```text
2026-04-15T07:00:00Z through 2026-04-16T07:00:00Z
```

If an Illinois job is not visible in the daily email summary yet, check these in the Azure Function App settings:

- `BULLHORN_ENV` must point to the Bullhorn environment where the job was created.
- `WEBSITE_TIME_ZONE` changes when the daily timer fires.
- `AZURE_NEW_JOB_ILLINOIS_EMAIL_SCHEDULE` overrides the default `07:00` schedule.
- `DRY_RUN=true` records the email as `would-send-email`; `DRY_RUN=false` records it as `sent-email`.
- `AZURE_WORKFLOW_DAILY_EMAIL_TABLE_NAME` controls which table the summary API reads. The default is `WorkflowDailyEmailRecords`.

The `daily-workflow-email-summary` API does not read the JSON files in `reports/`. It reads normalized recipient-level rows from Azure Table Storage. The partition key for this workflow is:

```text
{environment}|new-job-illinois-email-sync|{YYYY-MM-DD}
```

For example:

```text
production|new-job-illinois-email-sync|2026-04-17
```

Local runs such as `npm run run:new-job-illinois-email-sync` write report JSON files, but they do not write `WorkflowDailyEmailRecords`. Those table rows are written by the Azure Functions wrapper in `functionApp.js` after the workflow runs through the timer or HTTP endpoint.

## Important security note

The credentials shared in chat should be treated as compromised. Rotate all Bullhorn `client_secret`, user password, access tokens, and any related secrets before using this in production.

## Local run

1. Copy `.env.example` to `.env`.
2. Fill in your Bullhorn values.
3. Run:

```bash
npm ci
npm run run:workflow
npm run run:client-contact-dnc-sync
npm run run:placement-database-enrichment-sync
npm run run:placement-status-sync
npm run run:placement-termination-email-sync
npm run run:interview-illinois-email-test-send
npm run run:interview-illinois-email-sync
npm run run:placement-start-reminder-sync
npm run run:placement-benefits-reminder-sync
npm run run:placement-benefits-reminder-test-send
npm run run:placement-yearly-fee-increase-sync
npm run run:placement-yearly-fee-increase-test-send
npm run run:client-corporation-360-sync
npm run run:client-corporation-key-account-sync
```

`DRY_RUN=true` logs intended updates without writing to Bullhorn, including a simulated post-update candidate object preview.
`TEST_CANDIDATE_ID=2923234` restricts the run to exactly one candidate by id.
Each run writes `reports/changes-report-<timestamp>.json` with all affected candidates and field-level changes.
Placement start reminder runs write both `reports/placement-start-reminder-report-<timestamp>.json` and `reports/placement-start-reminder-sparkpost-payload-<timestamp>.json`.
Placement benefits reminder runs write both `reports/placement-benefits-reminder-report-<timestamp>.json` and `reports/placement-benefits-reminder-sparkpost-payload-<timestamp>.json`.
Placement benefits reminder test sends write `reports/placement-benefits-reminder-sparkpost-test-payload-<timestamp>.json`.
Placement yearly fee increase runs write both `reports/placement-yearly-fee-increase-report-<timestamp>.json` and `reports/placement-yearly-fee-increase-sparkpost-payload-<timestamp>.json`.
Placement yearly fee increase test sends write `reports/placement-yearly-fee-increase-sparkpost-test-payload-<timestamp>.json`.
Placement termination email runs write both `reports/placement-termination-email-report-<timestamp>.json` and `reports/placement-termination-email-sparkpost-payload-<timestamp>.json`.
Illinois interview email runs write both `reports/interview-illinois-email-report-<timestamp>.json` and `reports/interview-illinois-email-sparkpost-payload-<timestamp>.json`.
Illinois interview test sends write `reports/interview-illinois-email-sparkpost-test-payload-<timestamp>.json`.
New Jobs Illinois email runs write both `reports/new-job-illinois-email-report-<timestamp>.json` and `reports/new-job-illinois-email-sparkpost-payload-<timestamp>.json`.

## Testing

### Placement Yearly Fee Increase Test Mode

When testing the placement yearly fee increase workflow with real Bullhorn data but no qualifying placements, you can enable test mode to use relaxed matching criteria:

```bash
# Enable test mode - only requires contract employment type + future end date
PLACEMENT_YEARLY_FEE_INCREASE_TEST_MODE=true npm run run:placement-yearly-fee-increase-sync

# Or run the test script directly
PLACEMENT_YEARLY_FEE_INCREASE_TEST_MODE=true node test-yearly-fee-increase.js
```

**Test Mode Criteria (relaxed):**
- Employment type must be "contract"
- Placement end date must be in the future
- If both window values are left at `0`, the workflow automatically expands the query window to 3 days before and after the target date

**Production Criteria (strict):**
- Employment type must be "contract"
- Client corporation must have TOB date (`customDate1`)
- Billing frequency must be 1-10 (fee increase percentage)
- Placement end date must be in the future

Use `DRY_RUN=true` (default) to test without sending actual emails.

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
- `CANDIDATE_STATE_SYNC_CUTOFF_DATE` (default: `2018-10-31`; candidate state sync ignores candidates added before this date)
- `CLIENT_CORPORATION_360_CUTOFF_DATE` (default: `2023-12-01`)
- `CLIENT_CORPORATION_360_DELAY_HOURS` (default: `24`)
- `CLIENT_CORPORATION_360_QUERY_COUNT` (default: `200`)
- `CLIENT_CORPORATION_360_WINDOW_DAYS` (default: `30`)
- `CLIENT_CORPORATION_KEY_ACCOUNT_CUTOFF_DATE` (default: `2024-01-01`)
- `CLIENT_CORPORATION_KEY_ACCOUNT_DELAY_HOURS` (default: `24`)
- `CLIENT_CORPORATION_KEY_ACCOUNT_QUERY_COUNT` (default: `200`)
- `CLIENT_CORPORATION_KEY_ACCOUNT_WINDOW_DAYS` (default: `30`)
- `CLIENT_CONTACT_DNC_CUTOFF_DATE` (default: `2024-01-01`)
- `CLIENT_CONTACT_DNC_DELAY_HOURS` (default: `60`)
- `CLIENT_CONTACT_DNC_SCAN_WINDOW_HOURS` (default: `24`; how wide the rolling `contact.dateAdded` eligibility window is for the delayed scan)
- `CLIENT_CONTACT_DNC_EVENT_SUBSCRIPTION_ID` (default: `sense-client-contact-dnc-sync`)
- `CLIENT_CONTACT_DNC_EVENT_MAX_EVENTS` (default: `100`)
- `CLIENT_CONTACT_DNC_QUERY_COUNT` (default: `500`)
- `DRY_RUN` (default: `true`)
- `TEST_CANDIDATE_ID` (optional; when set, query uses `id:<value>` instead of `dateAdded`)
- `TEST_CLIENT_CORPORATION_ID` (optional; when set, query uses `id:<value>` instead of the cutoff date search)
- `TEST_CLIENT_CONTACT_ID` (optional; when set, query uses `id:<value>` instead of the contact `dateAdded` search)
- `PLACEMENT_EVENT_SUBSCRIPTION_ID` (default: `sense-placement-status-sync`)
- `PLACEMENT_EVENT_MAX_EVENTS` (default: `100`)
- `PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID` (default: `sense-placement-termination-email`)
- `PLACEMENT_TERMINATION_EVENT_MAX_EVENTS` (default: `100`)
- `INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID` (default: `sense-interview-illinois-email`)
- `INTERVIEW_ILLINOIS_EVENT_MAX_EVENTS` (default: `100`)
- `INTERVIEW_ILLINOIS_JOB_ORDER_STATE` (default: `Illinois`)
- `INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED` (default: `2024-05-01`)
- `INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE` (default: `contract`)
- `NEW_JOB_ILLINOIS_GRACE_HOURS` (default: `24`; wait this many hours after `JobOrder.dateAdded` before including a job)
- `NEW_JOB_ILLINOIS_QUERY_COUNT` (default: `200`)
- `NEW_JOB_ILLINOIS_JOB_ORDER_STATE` (default: `Illinois`)
- `NEW_JOB_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE` (default: `contract`)
- `NEW_JOB_ILLINOIS_SPARKPOST_TEMPLATE_ID` (optional; falls back to `SPARKPOST_TEMPLATE_ID`)
- `PLACEMENT_START_REMINDER_DAYS_AHEAD` (default: `4`)
- `PLACEMENT_START_REMINDER_QUERY_COUNT` (default: `200`)
- `PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS` (default: `0`; expands the query window backward for testing)
- `PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS` (default: `0`; expands the query window forward for testing)
- `PLACEMENT_BENEFITS_REMINDER_QUERY_COUNT` (default: `200`)
- `PLACEMENT_BENEFITS_REMINDER_DAY10_SPARKPOST_TEMPLATE_ID` (required when `DRY_RUN=false`)
- `PLACEMENT_BENEFITS_REMINDER_DAY21_SPARKPOST_TEMPLATE_ID` (required when `DRY_RUN=false`)
- `PLACEMENT_BENEFITS_REMINDER_DAY26_SPARKPOST_TEMPLATE_ID` (required when `DRY_RUN=false`)
- `PLACEMENT_YEARLY_FEE_INCREASE_MONTH_OFFSET` (default: `11`)
- `PLACEMENT_YEARLY_FEE_INCREASE_QUERY_COUNT` (default: `200`)
- `PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_BEFORE_DAYS` (default: `0`)
- `PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_AFTER_DAYS` (default: `0`)
- `BULLHORN_<ENV>_PLACEMENT_START_REMINDER_DAYS_AHEAD` (optional env-specific override)
- `BULLHORN_<ENV>_PLACEMENT_START_REMINDER_QUERY_COUNT` (optional env-specific override)
- `BULLHORN_<ENV>_PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS` (optional env-specific override)
- `BULLHORN_<ENV>_PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS` (optional env-specific override)
- `SPARKPOST_API_BASE_URL` (default: `https://api.sparkpost.com`)
- `SPARKPOST_API_KEY` (required when `DRY_RUN=false`)
- `SPARKPOST_TEMPLATE_ID` (required when `DRY_RUN=false`)
- `INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID` (optional; falls back to `SPARKPOST_TEMPLATE_ID`)
- `PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID` (optional; falls back to `SPARKPOST_TEMPLATE_ID`)
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

- Azure Functions default schedule runs every 5 minutes (`0 */5 * * * *`).
- Can also run manually with `workflow_dispatch`.
- Uses a dedicated Bullhorn `Placement` event subscription queue.
- Consumes up to `PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS` queued events per run, then drains any backlog over later runs.
- Uploads `reports/placement-database-enrichment-report-*.json` as a workflow artifact (`bullhorn-placement-database-enrichment-report`).

Workflow file: `.github/workflows/bullhorn-client-contact-dnc-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Combines a delayed `ClientContact.dateAdded` scan with `ClientCorporation` status event handling.
- Interprets the 60-hour grace period as "do not enforce the delayed DNC rule until 60 hours after the contact was added."
- Uploads `reports/client-contact-dnc-report-*.json` as a workflow artifact (`bullhorn-client-contact-dnc-report`).

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

Workflow file: `.github/workflows/bullhorn-placement-yearly-fee-increase-sync.yml`

- Scheduled daily at `00:00 UTC`.
- Can also run manually with `workflow_dispatch`.
- Sends one reminder 11 months after `placement.dateBegin` for eligible contract placements.
- Uploads both `reports/placement-yearly-fee-increase-report-*.json` and `reports/placement-yearly-fee-increase-sparkpost-payload-*.json` as a workflow artifact (`bullhorn-placement-yearly-fee-increase-reports`).

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
- GitHub Actions can also use `npm run run:client-contact-dnc-sync`
- Azure Functions uses `functionApp.js` timer triggers that call the same exported `run()` functions

Azure schedules:

- `AZURE_CANDIDATE_SYNC_SCHEDULE` default: `0 0 2 * * *`
- `AZURE_CLIENT_CONTACT_DNC_SYNC_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_PLACEMENT_DATABASE_ENRICHMENT_SYNC_SCHEDULE` default: `0 1 0 * * *`
- `AZURE_PLACEMENT_STATUS_SYNC_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_PLACEMENT_TERMINATION_EMAIL_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_INTERVIEW_ILLINOIS_EMAIL_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_PLACEMENT_START_REMINDER_SCHEDULE` default: `0 0 0 * * *`
- `AZURE_PLACEMENT_BENEFITS_REMINDER_SCHEDULE` default: `0 0 17 * * *`
- `AZURE_PLACEMENT_YEARLY_FEE_INCREASE_SCHEDULE` default: `0 0 0 * * *`
- `AZURE_CLIENT_CORPORATION_360_SYNC_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_CLIENT_CORPORATION_KEY_ACCOUNT_SYNC_SCHEDULE` default: `0 */5 * * * *`

For the benefits reminder schedule, set `WEBSITE_TIME_ZONE=Pacific Standard Time` in Azure if you want `AZURE_PLACEMENT_BENEFITS_REMINDER_SCHEDULE` to be interpreted as 5:00 PM Pacific time with daylight-saving handling.

## Azure Functions + Logic Apps

Recommended split for this repo:

- Azure Functions owns the Bullhorn workflow logic and SparkPost integrations.
- Logic Apps calls HTTP-triggered Functions for orchestration, visibility, approvals, and notifications.

The same workflow can now be run three ways:

- locally through `npm run ...`
- on a schedule through Azure timer-triggered Functions
- from Logic Apps through HTTP-triggered Functions

### Suggested SparkPost Template Copy

For the placement yearly fee increase reminder, a SparkPost template body can use the substitution fields from this workflow like this:

```html
<p>Hello,</p>
<p>
  This is a reminder that <strong>{{client_company_name}}</strong> has agreed to an automatic
  charge rate increase of <strong>{{yearly_fee_increase_percent}}%</strong> every 12 months.
</p>
<p>
  Placement #<strong>{{placement_id}}</strong> for <strong>{{candidate_name}}</strong> started
  11 months ago on <strong>{{placement_start_date}}</strong>. Please submit a change request
  effective on the 1-year mark, with uplifted charge rates.
</p>
<p>
  This is also a good time to inform your client in case they need to amend a purchase order
  to accommodate the change.
</p>
<p>Best Regards,</p>
```

### Logic App call pattern

Each workflow has an HTTP-triggered Function with `authLevel: "function"`, so Logic Apps should call it with `POST` and include the Function key.

Routes:

- `POST /api/workflows/candidate-state-sync`
- `POST /api/workflows/client-contact-dnc-sync`
- `POST /api/workflows/placement-database-enrichment-sync`
- `POST /api/workflows/placement-status-sync`
- `POST /api/workflows/placement-termination-email-sync`
- `POST /api/workflows/interview-illinois-email-sync`
- `POST /api/workflows/placement-start-reminder-sync`
- `POST /api/workflows/placement-benefits-reminder-sync`
- `POST /api/workflows/placement-benefits-reminder-test-send`
- `POST /api/workflows/placement-yearly-fee-increase-sync`
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
- `src/clientContactDncSync.js`: Combined client contact DNC runner.
- `src/placementDatabaseEnrichmentSync.js`: Daily placement database enrichment runner.
- `src/placementStatusSync.js`: Placement status transition runner.
- `src/placementTerminationEmailSync.js`: Placement termination email runner.
- `src/interviewIllinoisEmailSync.js`: Illinois interview notification runner.
- `src/placementStartReminderSync.js`: Placement start reminder enrichment runner.
- `src/placementBenefitsReminderSync.js`: Combined day 10 / day 21 / day 26 placement benefits reminder runner.
- `src/placementYearlyFeeIncreaseSync.js`: Placement yearly fee increase reminder runner.
- `src/placementStartReminderUtils.js`: Placement reminder substitution and formatting helpers.
- `src/placementBenefitsReminderUtils.js`: Placement benefits reminder date planning, filters, and SparkPost helpers.
- `src/placementYearlyFeeIncreaseUtils.js`: Placement yearly fee increase filters and SparkPost helpers.
- `src/placementTerminationEmailUtils.js`: Placement termination email helpers.
- `src/interviewIllinoisEmailUtils.js`: Illinois interview filter and substitution helpers.
- `src/sparkPostClient.js`: SparkPost transmission client.
- `src/clientCorporation360Sync.js`: Client corporation `customText7 -> 360` cleanup runner.
- `src/clientCorporationKeyAccountSync.js`: Client corporation `customText7 -> Key Account` cleanup runner.
- `functionApp.js`: Azure Functions timer and HTTP entrypoints.
- `src/workflowRuntime.js`: Shared workflow result, HTTP response, and JSON artifact helpers.
- `src/bullhornClient.js`: Bullhorn auth/search/update calls.
- `src/phoneUtils.js`: Phone parsing and mapping logic.
- `src/clientContactDncSyncUtils.js`: Client contact DNC filters, transition checks, and patch helpers.
- `src/placementDatabaseEnrichmentUtils.js`: Placement database enrichment filters and patch helpers.
- `src/placementUtils.js`: Placement transition mapping helpers.
- `src/clientCorporation360Utils.js`: Client corporation cleanup filters and patch helpers.
- `src/clientCorporationKeyAccountUtils.js`: Client corporation key account cleanup filters and patch helpers.
- `src/areaCodeToState.js`: Area-code -> state map.
- `src/callingCodeToCountryId.js`: Calling-code -> countryID map.
- `src/countryIdToCountry.js`: CountryID -> `{ countryCode, countryName }` map.
