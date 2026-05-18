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
11. Applications from all Job Boards
12. Vestas PO

Minimal Node.js workflow to:

1. Authenticate to Bullhorn.
2. Search recently added candidates (`dateAdded` window), but never before the configured candidate cutoff date.
3. Locally skip any returned candidate whose `dateAdded` is outside that same window.
4. Read candidate phone numbers (`phone`, `mobile`, `phone2`, `phone3`).
5. Infer region from phone number:
   - `+1` numbers use US area code (example: `515` -> `IA`).
   - Non-US normalization uses `address.countryID` mapping (example: `2291` -> `MY` / `Malaysia`).
6. Update Bullhorn candidate address:
   - US number -> update `address.state`
   - Non-US candidate -> update `address.countryCode` and `address.countryName` from `address.countryID`

For controlled backfills, the HTTP endpoint accepts an explicit comma-separated
candidate ID list:

```text
POST /api/workflows/candidate-state-sync?candidateIds=1776036,1776057,1776027
```

The workflow fetches those exact candidates and then applies the normal
`CANDIDATE_STATE_SYNC_CUTOFF_DATE`, phone mapping, and no-change checks. Explicit
candidate ID runs do not apply the rolling `LOOKBACK_HOURS` window. Run it with
`DRY_RUN=true` first and review `affectedCandidates` before allowing writes.

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
6. For `contract` placements whose `dateEnd` is before today, update the related candidate from `Placed by us` back to `Active`.
7. For all other employment types, skip placements whose status is `terminated`, `rejected`, `fall out`, or `temporarily suspended`.
8. Update the related candidate for eligible active placements:
   - `companyName` -> placement `clientCorporation.name`
   - `occupation` -> placement `jobOrder.title`
   - `status` -> `Placed by us`
   - `dateAvailable` -> `dateEnd + 1 day` for non-perm placements
   - `hourlyRateLow` -> placement `payRate` for non-perm placements
9. Update only `status` -> `Active` for finished `contract` placements when the candidate is currently `Placed by us`.

The placement database enrichment workflow is queue-based, not a full placement scan. There is no static placement `dateAdded` cutoff. The `PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS` setting limits the number of queued Bullhorn events consumed in a single run, not the total number that can ever be processed. With the Azure Functions default schedule of every 5 minutes, a backlog should drain over multiple runs as long as new events do not arrive faster than the workflow can consume them. If the queue regularly has more than 100 events per run, increase `PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS`, run the HTTP endpoint manually to drain the backlog, or shorten the schedule interval.

It also includes a client contact DNC automation:

1. Search `ClientContact` records added on or after a cutoff date.
2. Wait until at least 60 hours have passed since `contact.dateAdded` before enforcing the delayed new-contact rule.
3. For delayed new contacts, update the contact only when the related `clientCorporation.status = Do Not Contact`, the contact is not already `Do Not Contact`, and the contact name does not start with `..` or `****`.
4. During the scan, if a related `clientCorporation.status = Active`, update `Do Not Contact` contacts to `massMailOptOut = No` and `status = Active`.
5. Subscribe to `ClientCorporation` update events and consume status changes on a schedule.
6. When `clientCorporation.status` changes from `Do Not Contact -> Active`, update related contacts to `massMailOptOut = No` and `status = Active`.
7. When `clientCorporation.status` changes from anything other than `Do Not Contact` -> `Do Not Contact`, update related contacts to `massMailOptOut = Yes` and `status = Do Not Contact`.
8. If a `ClientCorporation` status event has a company ID but no transaction ID, load the company's contacts and reconcile them from the company's current status.
9. Event-driven updates also skip blocked contact names (`..`, `****`), and reactivation applies to contacts currently in `Do Not Contact`.

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

It also includes a start date approval reminder automation:

1. Run as an Azure Function workflow with Pacific-time business-date logic and an internal `12:00 AM` Pacific send hour check.
2. Send reminder stages at `placement.dateBegin + 2` days and `placement.dateBegin + 10` days, including Friday/Monday weekend adjustment to the nearest business day.
3. Keep only placements where `dateBegin >= 2022-12-01`, `status` is `qc approved` or `pre-hire`, and `owner.pager` maps to one of the configured Americas, APAC, or EMEA regions.
4. Send the reminder to `placement.owner.email` and CC `placement.jobOrder.owner.reportToPerson.email`.
5. For Americas only, include a yes/no survey that uses the same signed-response pattern as the existing confirmation workflows and stores the answer in Azure Table Storage.

It also includes a combined Americas onboarding notices automation:

1. Runs as one Azure Function workflow for the Colorado, Michigan, New York City Hero Act, and New York City Commuter onboarding notices.
2. Queries placements by `dateBegin` and applies Pacific-time send-hour rules per state workflow.
3. Uses Friday/Monday weekend adjustment for Colorado, Michigan, and the New York City Commuter notice, and sends on weekends as-is for the New York City Hero Act notice.
4. Sends Colorado and Michigan sick-time notices to the candidate with the required attachment.
5. Sends the New York City Hero Act notice to the candidate from the candidate owner, CCs onboarding, records the yes/no survey response in the shared `WorkflowSurveyResponses` table, and separately notifies the candidate owner one day after a placement moves to `qc approved` for New York commuter-benefit review.

It also includes a combined SO How Did We Do feedback automation:

1. Runs as one Azure Function workflow for 5 migrated Sense feedback surveys covering candidate and client-contact sends at both placement start and placement end.
2. Sends the initial survey email at `11:00 AM` Pacific based on `placement.dateBegin` or `placement.dateEnd` plus each rule's configured delay, without weekend suppression for the initial send.
3. Uses a signed 1-to-10 survey link pattern backed by the shared `WorkflowSurveyResponses` table and a dedicated `WorkflowSurveyTracking` table for reminder lifecycle state.
4. Sends at most one reminder email 3 calendar days after the initial send, skips weekend reminder sends, and catches weekend-due reminders on Monday.
5. Writes dry-run reports with matched initial sends, reminder candidates, skips, and SparkPost payload previews even when no Azure rows are persisted.

It also includes a combined placement termination workflows automation for the 12 migrated Sense termination workflows:

1. Runs as one Azure Function workflow with separate rule definitions for each state/process.
2. Scans `Placement.dateEnd` windows and `PlacementEditHistory` status / termination-reason changes according to each rule.
3. Applies lowercase-style comparisons for state, country, status, employment type, termination reason, and owner department checks.
4. Handles Pacific-time 9am rules, one-day/hour delays, and Friday/Monday weekend adjustments per workflow.
5. Sends SparkPost inline transmissions with attachments from `attachments/`.
6. Keeps email bodies in dedicated HTML templates under `templates/termination-*.html`; exact duplicate copy is shared through reusable templates such as `termination-generic-unemployment-notice.html`, and plain-text content is derived from the same HTML so copy changes only need to be made once.

It also includes an Illinois interview notification automation:

1. Subscribe to Bullhorn `Appointment` insert events with a dedicated subscription queue.
2. Consume recent appointment events from Bullhorn on a schedule.
3. Keep only appointments where `type = Interview`.
4. Filter the related `jobOrder` to `address.state = Illinois`, `dateAdded = 2024-05-01`, and `employmentType = contract`.
5. Fetch the job order owner and send one SparkPost email per matching interview.
6. Send one SparkPost transmission containing all recipients, or write dry-run preview reports when `DRY_RUN=true`.

It also includes a job application notification automation:

1. Subscribe to Bullhorn `JobSubmission` insert events with a dedicated subscription queue.
2. Consume recent application events from Bullhorn on a schedule, including weekends.
3. Fetch the job submission, candidate, job order, client corporation, and job order owner.
4. Send the Sales Operations Team notification when `JobSubmission.source` is in the configured job-board list and `jobOrder.owner.pager = 500`.
5. Send one inline SparkPost transmission per matching application, or write dry-run preview reports when `DRY_RUN=true`.

It also includes a Vestas PO automation:

1. Run as a scheduled Azure Function at `6:00 AM` Pacific.
2. Query Bullhorn `Placement.dateAdded` for the active Pacific business date.
3. Skip weekend timer sends and catch Saturday/Sunday `dateAdded` placements on Monday.
4. Keep only placements where `clientCorporation.id = 10752`.
5. Send the purchase order request to `placement.owner.email`, falling back to `jobOrder.owner.email` if needed, and CC `usainvoices@spencer-ogden.com` and `mindy.prefling@spencer-ogden.com`.
6. Attach `attachments/Vestas TOB.pdf`.
7. Include a signed one-choice survey for purchase order turnaround time and save responses to the shared workflow survey response table.
8. Keep the email HTML in `templates/vestas-po.html` using the standard project email theme.
9. Survey response route: `GET/POST /api/workflows/vestas-po/respond`.

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
- `AZURE_WORKFLOW_DASHBOARD_BY_DAY_TABLE_NAME` controls the aggregate day table that the summary API reads.

The `daily-workflow-email-summary` API does not read the JSON files in `reports/`. It reads aggregate workflow/day rows from Azure Table Storage. The month partition key for dashboard-by-day reads is:

```text
{environment}|{YYYY-MM}
```

For example:

```text
production|2026-04
```

Within that partition, each row key is:

```text
{YYYY-MM-DD}|{workflowName}
```

For example:

```text
2026-04-17|new-job-illinois-email-sync
```

Local runs such as `npm run run:new-job-illinois-email-sync` write report JSON files, but they do not write dashboard table rows. Those aggregate rows are written by the Azure Functions wrapper in `functionApp.js` after the workflow runs through the timer or HTTP endpoint.

Dashboard storage now uses an aggregate-first model. Instead of persisting raw comparison rows, field-level change rows, and recipient-level email rows for the frontend, the Azure Functions wrapper writes:

1. `WorkflowRunLogs` for lightweight recent run history
2. `WorkflowDashboardByDay` for per-day, per-workflow dashboard reads
3. `WorkflowDashboardByWorkflow` for per-workflow trend reads

These aggregate tables keep the same core meanings such as successful items, failed items, skipped items, update counts, email counts, field counts, skip reason counts, and action-decision counts, but they store them precomputed per workflow/day instead of as raw event rows.

PostgreSQL reporting is also supported through `POSTGRES_CONNECTION_STRING`. When it is configured, the repo dual-writes workflow run logs, dashboard aggregates, generic workflow survey tracking, generic workflow survey responses, workflow comparison records, and data mutation audit rows to PostgreSQL while keeping the existing Azure Table operational writes in place. The daily summary and dashboard summary readers prefer PostgreSQL when rows are available and fall back to Azure Tables otherwise.

Dashboard HTTP APIs are available for the future Next.js frontend and AI sidebar. They are read-only and aggregate-first, so they do not execute workflows or write workflow run logs:

```text
GET /api/dashboard/workflows
GET /api/dashboard/summary?dateFrom=2026-05-01&dateTo=2026-05-15
GET /api/dashboard/trends?month=2026-05&workflowName=job-application-notification-sync
GET /api/dashboard/runs?dateFrom=2026-05-01&dateTo=2026-05-15&status=failed
GET /api/dashboard/emails?dateFrom=2026-05-01&dateTo=2026-05-15
GET /api/dashboard/skips?dateFrom=2026-05-01&dateTo=2026-05-15
GET /api/dashboard/ai-context?dateFrom=2026-05-01&dateTo=2026-05-15
GET /api/dashboard/data-mutations?dateFrom=2026-05-01&dateTo=2026-05-15&workflowName=placement-database-enrichment-sync
GET /api/dashboard/email-transmissions?dateFrom=2026-05-01&dateTo=2026-05-15
```

Supported filters are `dateFrom`, `dateTo`, `month`, `workflowName` (comma-separated), `category`, `status`, `actionDecision`, and `includeRecords=true`. Date ranges default to the last 7 days and are capped at 92 days to keep UI and AI payloads concise.

The `workflow_data_mutation_audit` table is the row-level audit trail for workflows that update Bullhorn data. It stores one row per changed field, including workflow name, run date, dry-run/live action, entity type/id, related candidate/placement/client-contact/client-corporation ids, field name, old value, new value, reason, and a JSON copy of the source report record. It is currently wired into:

- `candidate-state-sync`
- `placement-database-enrichment-sync`
- `client-contact-dnc-sync`
- `client-corporation-360-sync`
- `client-corporation-key-account-sync`
- `placement-status-sync`

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
npm run run:placement-termination-workflows-sync
npm run run:interview-illinois-email-test-send
npm run run:interview-illinois-email-sync
npm run run:job-application-notification-sync
npm run run:vestas-po-sync
npm run run:placement-start-reminder-sync
npm run run:americas-onboarding-notices-sync
npm run run:ais-survivex-certification-sync
npm run run:americas-welcome-contract-email-sync
npm run run:fair-collection-notice-sync
npm run run:so-how-did-we-do-feedback-sync
npm run run:start-date-approval-reminder-sync
npm run run:placement-benefits-reminder-sync
npm run run:placement-benefits-reminder-test-send
npm run run:payroll-new-hire-greeting-sync
npm run run:placement-end-date-reminder-sync
npm run run:placement-yearly-fee-increase-sync
npm run run:placement-yearly-fee-increase-test-send
npm run run:client-corporation-360-sync
npm run run:client-corporation-key-account-sync
```

`DRY_RUN=true` logs intended updates without writing to Bullhorn, including a simulated post-update candidate object preview.
`TEST_CANDIDATE_ID=2923234` restricts the run to exactly one candidate by id.
Each run writes reports into date-based folders under `reports/YYYY-MM-DD/`, using the report generation date in UTC.
Candidate state sync writes `reports/YYYY-MM-DD/changes-report-<timestamp>.json` with all affected candidates and field-level changes.
Placement start reminder runs write both `reports/YYYY-MM-DD/placement-start-reminder-report-<timestamp>.json` and `reports/YYYY-MM-DD/placement-start-reminder-sparkpost-payload-<timestamp>.json`.
Americas onboarding notices runs write both `reports/YYYY-MM-DD/americas-onboarding-notices-report-<timestamp>.json` and `reports/YYYY-MM-DD/americas-onboarding-notices-sparkpost-payload-<timestamp>.json`.
AIS Survivex certification runs write both `reports/YYYY-MM-DD/ais-survivex-certification-report-<timestamp>.json` and `reports/YYYY-MM-DD/ais-survivex-certification-sparkpost-payload-<timestamp>.json`.
Americas welcome contract email runs write both `reports/YYYY-MM-DD/americas-welcome-contract-email-report-<timestamp>.json` and `reports/YYYY-MM-DD/americas-welcome-contract-email-sparkpost-payload-<timestamp>.json`.
Americas welcome contract email maps the Sense `last_note_action_type = Talent platform initiated` rule to Bullhorn Candidate `customText16`, whose metadata label is `Initiate Onboarding`. Bullhorn does not expose `CandidateEditHistory` in this tenant, so the workflow scans recently modified candidates and checks the current `customText16` value rather than proving an edit-history transition. `AMERICAS_WELCOME_CONTRACT_EMAIL_ACTION_TYPE_FIELD` can override the field name if the mapping changes.
Fair collection notice runs write both `reports/YYYY-MM-DD/fair-collection-notice-report-<timestamp>.json` and `reports/YYYY-MM-DD/fair-collection-notice-sparkpost-payload-<timestamp>.json`.
SO How Did We Do feedback runs write both `reports/YYYY-MM-DD/so-how-did-we-do-feedback-report-<timestamp>.json` and `reports/YYYY-MM-DD/so-how-did-we-do-feedback-sparkpost-payload-<timestamp>.json`.
Start date approval reminder runs write both `reports/YYYY-MM-DD/start-date-approval-reminder-report-<timestamp>.json` and `reports/YYYY-MM-DD/start-date-approval-reminder-sparkpost-payload-<timestamp>.json`.
Placement benefits reminder runs write both `reports/YYYY-MM-DD/placement-benefits-reminder-report-<timestamp>.json` and `reports/YYYY-MM-DD/placement-benefits-reminder-sparkpost-payload-<timestamp>.json`.
Placement benefits reminder test sends write `reports/YYYY-MM-DD/placement-benefits-reminder-sparkpost-test-payload-<timestamp>.json`.
Payroll new hire greeting runs write both `reports/YYYY-MM-DD/payroll-new-hire-greeting-report-<timestamp>.json` and `reports/YYYY-MM-DD/payroll-new-hire-greeting-sparkpost-payload-<timestamp>.json`.
Placement end date reminder runs write both `reports/YYYY-MM-DD/placement-end-date-reminder-report-<timestamp>.json` and `reports/YYYY-MM-DD/placement-end-date-reminder-sparkpost-payload-<timestamp>.json`.
Placement yearly fee increase runs write both `reports/YYYY-MM-DD/placement-yearly-fee-increase-report-<timestamp>.json` and `reports/YYYY-MM-DD/placement-yearly-fee-increase-sparkpost-payload-<timestamp>.json`.
Placement yearly fee increase test sends write `reports/YYYY-MM-DD/placement-yearly-fee-increase-sparkpost-test-payload-<timestamp>.json`.
Placement termination email runs write both `reports/YYYY-MM-DD/placement-termination-email-report-<timestamp>.json` and `reports/YYYY-MM-DD/placement-termination-email-sparkpost-payload-<timestamp>.json`.
Placement termination workflows runs write both `reports/YYYY-MM-DD/placement-termination-workflows-report-<timestamp>.json` and `reports/YYYY-MM-DD/placement-termination-workflows-sparkpost-payload-<timestamp>.json`.
Illinois interview email runs write both `reports/YYYY-MM-DD/interview-illinois-email-report-<timestamp>.json` and `reports/YYYY-MM-DD/interview-illinois-email-sparkpost-payload-<timestamp>.json`.
Illinois interview test sends write `reports/YYYY-MM-DD/interview-illinois-email-sparkpost-test-payload-<timestamp>.json`.
Job application notification runs write both `reports/YYYY-MM-DD/job-application-notification-report-<timestamp>.json` and `reports/YYYY-MM-DD/job-application-notification-sparkpost-payload-<timestamp>.json`.
Vestas PO runs write both `reports/YYYY-MM-DD/vestas-po-report-<timestamp>.json` and `reports/YYYY-MM-DD/vestas-po-sparkpost-payload-<timestamp>.json`.
New Jobs Illinois email runs write both `reports/YYYY-MM-DD/new-job-illinois-email-report-<timestamp>.json` and `reports/YYYY-MM-DD/new-job-illinois-email-sparkpost-payload-<timestamp>.json`.

## Email Templates

Email templates are split between local inline HTML files in this repository and templates that are expected to be stored in SparkPost and referenced by template ID.

### Local Inline Templates

These files live in `templates/` and are rendered by the FunctionApp code before sending inline SparkPost transmissions, or kept as local source/preview material for migrated template copy:

| File | Primary use |
| --- | --- |
| `ais-survivex-certification-renewal.html` | AIS/Survivex certification renewal email |
| `americas-new-york-city-commuter.html` | New York City commuter internal placement notice |
| `americas-new-york-city-hero-act.html` | New York City HERO Act survey notice |
| `americas-oregon-workplace-fairness.html` | Oregon Workplace Fairness Policy notice |
| `americas-paid-leave-onboarding.html` | Colorado and Michigan paid leave onboarding notices |
| `americas-welcome-contract-email.html` | Americas welcome email for US contract candidates |
| `fair-collection-notice.html` | Fair Collection Notice for newly added candidates |
| `harassment-training-california-notice.html` | Local source for California harassment training SparkPost template |
| `harassment-training-onboarding-confirmation.html` | Local source for harassment training onboarding confirmation SparkPost template |
| `harassment-training-state-notice.html` | Local source for Connecticut/New York harassment training SparkPost template |
| `so-how-did-we-do-feedback.html` | SO How Did We Do feedback survey email |
| `so-how-did-we-do-reminder.html` | SO How Did We Do reminder email |
| `start-date-approval-reminder.html` | Start date approval reminder email |
| `termination-alabama-notice.html` | Alabama termination notice |
| `termination-apac-perm-invoicing.html` | APAC perm termination invoicing notice |
| `termination-california-change-in-relationship.html` | California notice to employee of change in relationship |
| `termination-colorado.html` | Colorado termination notice |
| `termination-end-of-month-contract-reminder.html` | US contract ending soon reminder |
| `termination-generic-unemployment-notice.html` | Shared unemployment notice template for multiple states |
| `termination-georgia.html` | Georgia termination notice |
| `termination-maryland.html` | Maryland termination notice |
| `termination-new-jersey-unemployment-benefits.html` | New Jersey unemployment benefits notice |
| `termination-us-perm-invoice.html` | US perm termination invoice notice |
| `us-contract-performance-checkin.html` | US contract performance check-in email |

`templates/sparkpost-preview-substitution-data.json` is preview data, not an email template.

### SparkPost-Managed Templates

These templates are stored in SparkPost and selected by environment/config values. Some have local HTML source files above so copy can be versioned here, but the runtime sends by SparkPost `template_id`.

| Config key | Workflow/use |
| --- | --- |
| `SPARKPOST_TEMPLATE_ID` | Generic fallback template ID used by older template-based workflows |
| `INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID` | Illinois interview email |
| `NEW_JOB_ILLINOIS_SPARKPOST_TEMPLATE_ID` | New Jobs Illinois email |
| `PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID` | Placement termination email workflow |
| `PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID` | Placement yearly fee increase reminder |
| `PLACEMENT_BENEFITS_REMINDER_DAY10_SPARKPOST_TEMPLATE_ID` | Placement benefits reminder, day 10 |
| `PLACEMENT_BENEFITS_REMINDER_DAY21_SPARKPOST_TEMPLATE_ID` | Placement benefits reminder, day 21 |
| `PLACEMENT_BENEFITS_REMINDER_DAY26_SPARKPOST_TEMPLATE_ID` | Placement benefits reminder, day 26 |
| `HARASSMENT_TRAINING_SPARKPOST_TEMPLATE_ID` | Harassment training fallback template ID |
| `HARASSMENT_TRAINING_ONBOARDING_SPARKPOST_TEMPLATE_ID` | Harassment training onboarding confirmation |
| `HARASSMENT_TRAINING_STATE_NOTICE_SPARKPOST_TEMPLATE_ID` | Harassment training state notice |
| `HARASSMENT_TRAINING_CALIFORNIA_SPARKPOST_TEMPLATE_ID` | Harassment training California notice |

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
- `PLACEMENT_TERMINATION_WORKFLOWS_QUERY_COUNT` (default: `200`)
- `PLACEMENT_TERMINATION_WORKFLOWS_TARGET_DATE` (optional; `YYYY-MM-DD` override for dry-run/backfill testing)
- `AMERICAS_ONBOARDING_NOTICES_QUERY_COUNT` (default: `200`)
- `AMERICAS_ONBOARDING_NOTICES_TARGET_DATE` (optional; `YYYY-MM-DD` override for dry-run/backfill testing)
- `AMERICAS_ONBOARDING_NOTICES_EXTRA_DATE_BEGIN_STATUSES` (optional comma-separated extra statuses for temporary testing, for example `submitted,pre-hire`)
- `SO_HOW_DID_WE_DO_QUERY_COUNT` (default: `200`)
- `SO_HOW_DID_WE_DO_TARGET_DATE` (optional; `YYYY-MM-DD` override for dry-run/backfill testing)
- `START_DATE_APPROVAL_REMINDER_QUERY_COUNT` (default: `200`)
- `START_DATE_APPROVAL_REMINDER_TARGET_DATE` (optional; `YYYY-MM-DD` override for dry-run/backfill testing)
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
- `PAYROLL_NEW_HIRE_GREETING_QUERY_COUNT` (default: `200`)
- `PAYROLL_NEW_HIRE_GREETING_TARGET_DATE` (optional `YYYY-MM-DD` override)
- `PLACEMENT_END_DATE_REMINDER_QUERY_COUNT` (default: `200`)
- `PLACEMENT_END_DATE_REMINDER_TARGET_DATE` (optional `YYYY-MM-DD` override)
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
- Uploads `reports/**/*.json` as a workflow artifact (`bullhorn-changes-report`).

Workflow file: `.github/workflows/bullhorn-placement-status-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uses Bullhorn event subscriptions for `Placement UPDATED`.
- Uploads `reports/**/placement-status-report-*.json` as a workflow artifact (`bullhorn-placement-status-report`).

Workflow file: `.github/workflows/bullhorn-placement-database-enrichment-sync.yml`

- Azure Functions default schedule runs every 5 minutes (`0 */5 * * * *`).
- Can also run manually with `workflow_dispatch`.
- Uses a dedicated Bullhorn `Placement` event subscription queue.
- Consumes up to `PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS` queued events per run, then drains any backlog over later runs.
- Uploads `reports/**/placement-database-enrichment-report-*.json` as a workflow artifact (`bullhorn-placement-database-enrichment-report`).

Workflow file: `.github/workflows/bullhorn-client-contact-dnc-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Combines a delayed `ClientContact.dateAdded` scan with `ClientCorporation` status event handling.
- Interprets the 60-hour grace period as "do not enforce the delayed DNC rule until 60 hours after the contact was added."
- Uploads `reports/**/client-contact-dnc-report-*.json` as a workflow artifact (`bullhorn-client-contact-dnc-report`).

Workflow file: `.github/workflows/bullhorn-placement-termination-email-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uses a dedicated Bullhorn event subscription queue for `Placement UPDATED`.
- Filters the consumed events to status changes where the new value is `terminated`.
- Uploads both `reports/**/placement-termination-email-report-*.json` and `reports/**/placement-termination-email-sparkpost-payload-*.json` as a workflow artifact (`bullhorn-placement-termination-email-reports`).

Workflow file: `.github/workflows/bullhorn-interview-illinois-email-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uses a dedicated Bullhorn event subscription queue for `Appointment INSERTED`.
- Filters the consumed appointments to `type = Interview` and the configured Illinois job order conditions.
- Uploads both `reports/**/interview-illinois-email-report-*.json` and `reports/**/interview-illinois-email-sparkpost-payload-*.json` as a workflow artifact (`bullhorn-interview-illinois-email-reports`).

Workflow file: `.github/workflows/bullhorn-client-corporation-360-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uploads `reports/**/client-corporation-360-report-*.json` as a workflow artifact (`bullhorn-client-corporation-360-report`).

Workflow file: `.github/workflows/bullhorn-client-corporation-key-account-sync.yml`

- Scheduled every 5 minutes.
- Can also run manually with `workflow_dispatch`.
- Uploads `reports/**/client-corporation-key-account-report-*.json` as a workflow artifact (`bullhorn-client-corporation-key-account-report`).

Workflow file: `.github/workflows/bullhorn-placement-start-reminder-sync.yml`

- Scheduled daily at `00:00 UTC`.
- Can also run manually with `workflow_dispatch`.
- Uploads both `reports/**/placement-start-reminder-report-*.json` and `reports/**/placement-start-reminder-sparkpost-payload-*.json` as a workflow artifact (`bullhorn-placement-start-reminder-reports`).

Workflow file: `.github/workflows/bullhorn-placement-yearly-fee-increase-sync.yml`

- Scheduled daily at `00:00 UTC`.
- Can also run manually with `workflow_dispatch`.
- Sends one reminder 11 months after `placement.dateBegin` for eligible contract placements.
- Uploads both `reports/**/placement-yearly-fee-increase-report-*.json` and `reports/**/placement-yearly-fee-increase-sparkpost-payload-*.json` as a workflow artifact (`bullhorn-placement-yearly-fee-increase-reports`).

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
- `AZURE_PLACEMENT_TERMINATION_WORKFLOWS_SCHEDULE` default: `0 0 * * * *`
- `AZURE_AMERICAS_ONBOARDING_NOTICES_SCHEDULE` default: `0 0 * * * *`
- `AZURE_AIS_SURVIVEX_CERTIFICATION_SCHEDULE` default: `0 0 * * * *`
- `AZURE_AMERICAS_WELCOME_CONTRACT_EMAIL_SCHEDULE` default: `0 0 * * * *`
- `AZURE_FAIR_COLLECTION_NOTICE_SCHEDULE` default: `0 0 * * * *`
- `AZURE_SO_HOW_DID_WE_DO_FEEDBACK_SCHEDULE` default: `0 0 11 * * *`
- `AZURE_START_DATE_APPROVAL_REMINDER_SCHEDULE` default: `0 0 * * * *`
- `AZURE_INTERVIEW_ILLINOIS_EMAIL_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_JOB_APPLICATION_NOTIFICATION_SCHEDULE` default: `0 */5 * * * *`
- `AZURE_VESTAS_PO_SCHEDULE` default: `0 0 * * * *`
- `AZURE_PLACEMENT_START_REMINDER_SCHEDULE` default: `0 0 0 * * *`
- `AZURE_PLACEMENT_BENEFITS_REMINDER_SCHEDULE` default: `0 0 17 * * *`
- `AZURE_PAYROLL_NEW_HIRE_GREETING_SCHEDULE` default: `0 0 * * * *`
- `AZURE_PLACEMENT_END_DATE_REMINDER_SCHEDULE` default: `0 0 * * * *`
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
- `POST /api/workflows/placement-termination-workflows-sync`
- `POST /api/workflows/interview-illinois-email-sync`
- `POST /api/workflows/job-application-notification-sync`
- `POST /api/workflows/vestas-po-sync`
- `POST /api/workflows/placement-start-reminder-sync`
- `POST /api/workflows/americas-onboarding-notices-sync`
- `POST /api/workflows/ais-survivex-certification-sync`
- `POST /api/workflows/americas-welcome-contract-email-sync`
- `POST /api/workflows/so-how-did-we-do-feedback-sync`
- `POST /api/workflows/start-date-approval-reminder-sync`
- `POST /api/workflows/placement-benefits-reminder-sync`
- `POST /api/workflows/placement-benefits-reminder-test-send`
- `POST /api/workflows/payroll-new-hire-greeting-sync`
- `POST /api/workflows/placement-end-date-reminder-sync`
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
    "reportPath": "/home/site/wwwroot/reports/2026-04-01/client-corporation-360-report-2026-04-01T02-00-07-000Z.json"
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
2. Fill in Bullhorn, SparkPost, storage, and PostgreSQL settings as needed
3. Install Azure Functions Core Tools locally
4. Run `npm ci`
5. Run the Function App locally:

```bash
npm run start:azure
```

That script runs:

```bash
func start
```

You can also run it directly from the repo root:

```bash
func start
```

By default the local Functions host listens at:

```text
http://localhost:7071/api
```

The Next.js dashboard can point to it with:

```text
WORKFLOW_API_BASE_URL=http://localhost:7071/api
WORKFLOW_API_CODE=
```

Example local HTTP workflow call:

```bash
curl -X POST "http://localhost:7071/api/workflows/payroll-new-hire-greeting-sync?targetDate=2026-05-18"
```

Notes:

- Azure timer schedules use NCRONTAB with a seconds field
- `AzureWebJobsStorage` is required by Azure Functions even though your workflow logic is external to Azure
- Reports still write to the local `reports/` folder for GitHub Actions and local runs; on Azure that filesystem is temporary, so prefer the HTTP summary response for Logic Apps and add Blob Storage later if you need durable report artifacts

## Files

- `src/workflows/runCandidateStateSync.js`: Candidate state cleanup runner.
- `src/workflows/clientContactDncSync.js`: Combined client contact DNC runner.
- `src/workflows/placementDatabaseEnrichmentSync.js`: Daily placement database enrichment runner.
- `src/workflows/placementStatusSync.js`: Placement status transition runner.
- `src/workflows/placementTerminationEmailSync.js`: Placement termination email runner.
- `src/workflows/placementTerminationWorkflowsSync.js`: Combined state/perm termination workflow runner.
- `src/workflows/interviewIllinoisEmailSync.js`: Illinois interview notification runner.
- `src/workflows/jobApplicationNotificationSync.js`: Combined job application notification runner.
- `src/workflows/vestasPoSync.js`: Vestas purchase order request runner.
- `src/workflows/placementStartReminderSync.js`: Placement start reminder enrichment runner.
- `src/workflows/americasOnboardingNoticesSync.js`: Combined Colorado, Michigan, New York City Hero Act, and New York City Commuter onboarding notices runner.
- `src/workflows/soHowDidWeDoFeedbackSync.js`: Combined SO How Did We Do feedback runner with initial-send and reminder tracking.
- `src/workflows/startDateApprovalReminderSync.js`: Start date approval reminder runner.
- `src/workflows/placementBenefitsReminderSync.js`: Combined day 10 / day 21 / day 26 placement benefits reminder runner.
- `src/workflows/placementYearlyFeeIncreaseSync.js`: Placement yearly fee increase reminder runner.
- `src/utils/placementStartReminderUtils.js`: Placement reminder substitution and formatting helpers.
- `src/utils/americasOnboardingNoticesUtils.js`: Americas onboarding rule, attachment, survey, and SparkPost helpers.
- `src/utils/soHowDidWeDoFeedbackUtils.js`: SO How Did We Do feedback rule, survey, reminder, and SparkPost helpers.
- `src/utils/startDateApprovalReminderUtils.js`: Start date approval reminder region, scheduling, survey, and SparkPost helpers.
- `src/utils/placementBenefitsReminderUtils.js`: Placement benefits reminder date planning, filters, and SparkPost helpers.
- `src/utils/placementYearlyFeeIncreaseUtils.js`: Placement yearly fee increase filters and SparkPost helpers.
- `src/utils/placementTerminationEmailUtils.js`: Placement termination email helpers.
- `src/utils/placementTerminationWorkflowsUtils.js`: Termination workflow rules, scheduling, attachments, templates, and inline SparkPost helpers.
- `src/utils/interviewIllinoisEmailUtils.js`: Illinois interview filter and substitution helpers.
- `src/utils/jobApplicationNotificationUtils.js`: Job application notification rules and inline SparkPost helpers.
- `src/utils/vestasPoUtils.js`: Vestas PO dateAdded planning, template rendering, attachment, and survey helpers.
- `src/clients/sparkPostClient.js`: SparkPost transmission client.
- `src/workflows/clientCorporation360Sync.js`: Client corporation `customText7 -> 360` cleanup runner.
- `src/workflows/clientCorporationKeyAccountSync.js`: Client corporation `customText7 -> Key Account` cleanup runner.
- `functionApp.js`: Azure Functions timer and HTTP entrypoints.
- `src/utils/workflowRuntime.js`: Shared workflow result, HTTP response, and JSON artifact helpers.
- `src/clients/bullhornClient.js`: Bullhorn auth/search/update calls.
- `src/helpers/phoneUtils.js`: Phone parsing and mapping logic.
- `src/utils/clientContactDncSyncUtils.js`: Client contact DNC filters, transition checks, and patch helpers.
- `src/utils/placementDatabaseEnrichmentUtils.js`: Placement database enrichment filters and patch helpers.
- `src/utils/placementUtils.js`: Placement transition mapping helpers.
- `src/utils/clientCorporation360Utils.js`: Client corporation cleanup filters and patch helpers.
- `src/utils/clientCorporationKeyAccountUtils.js`: Client corporation key account cleanup filters and patch helpers.
- `src/helpers/areaCodeToState.js`: Area-code -> state map.
- `src/helpers/callingCodeToCountryId.js`: Calling-code -> countryID map.
- `src/helpers/countryIdToCountry.js`: CountryID -> `{ countryCode, countryName }` map.
