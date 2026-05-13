const { z } = require("zod");

function emptyStringToUndefined(value) {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return value;
}

const envBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const optionalPositiveInt = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().positive().optional(),
);

const optionalString = z.preprocess(emptyStringToUndefined, z.string().min(1).optional());

const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());

const urlWithDefault = (defaultValue) =>
  z.preprocess(emptyStringToUndefined, z.string().url().default(defaultValue));

const stringWithDefault = (defaultValue) =>
  z.preprocess(emptyStringToUndefined, z.string().default(defaultValue));

const stringWithDefaultPreserveBlank = (defaultValue) => z.string().default(defaultValue);

const positiveIntWithDefault = (defaultValue) =>
  z.preprocess(emptyStringToUndefined, z.coerce.number().int().positive().default(defaultValue));

const nonNegativeIntWithDefault = (defaultValue) =>
  z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(0).default(defaultValue));

const configSchema = z.object({
  BULLHORN_ENV: z.enum(["staging", "production"]).default("production"),
  BULLHORN_CLIENT_ID: z.string().min(1),
  BULLHORN_CLIENT_SECRET: z.string().min(1),
  BULLHORN_USERNAME: z.string().min(1),
  BULLHORN_PASSWORD: z.string().min(1),
  BULLHORN_AUTH_BASE_URL: urlWithDefault("https://rest.bullhornstaffing.com"),
  BULLHORN_API_BASE_URL: optionalUrl,
  BULLHORN_REDIRECT_URI: z.string().url(),
  BULLHORN_API_VERSION: stringWithDefault("*"),
  LOOKBACK_HOURS: positiveIntWithDefault(60),
  CANDIDATE_STATE_SYNC_CUTOFF_DATE: stringWithDefault("2018-10-31"),
  CLIENT_CORPORATION_360_CUTOFF_DATE: stringWithDefault("2023-12-01"),
  CLIENT_CORPORATION_360_DELAY_HOURS: positiveIntWithDefault(24),
  CLIENT_CORPORATION_360_QUERY_COUNT: positiveIntWithDefault(200),
  CLIENT_CORPORATION_360_WINDOW_DAYS: positiveIntWithDefault(30),
  CLIENT_CORPORATION_KEY_ACCOUNT_CUTOFF_DATE: stringWithDefault("2024-01-01"),
  CLIENT_CORPORATION_KEY_ACCOUNT_DELAY_HOURS: positiveIntWithDefault(24),
  CLIENT_CORPORATION_KEY_ACCOUNT_QUERY_COUNT: positiveIntWithDefault(200),
  CLIENT_CORPORATION_KEY_ACCOUNT_WINDOW_DAYS: positiveIntWithDefault(30),
  CLIENT_CONTACT_DNC_CUTOFF_DATE: stringWithDefault("2024-01-01"),
  CLIENT_CONTACT_DNC_DELAY_HOURS: positiveIntWithDefault(60),
  CLIENT_CONTACT_DNC_SCAN_WINDOW_HOURS: positiveIntWithDefault(24),
  CLIENT_CONTACT_DNC_EVENT_SUBSCRIPTION_ID: stringWithDefault("sense-client-contact-dnc-sync"),
  CLIENT_CONTACT_DNC_EVENT_MAX_EVENTS: positiveIntWithDefault(100),
  CLIENT_CONTACT_DNC_QUERY_COUNT: positiveIntWithDefault(500),
  DRY_RUN: envBoolean,
  TEST_CANDIDATE_ID: optionalPositiveInt,
  TEST_CLIENT_CORPORATION_ID: optionalPositiveInt,
  TEST_CLIENT_CONTACT_ID: optionalPositiveInt,
  TEST_PLACEMENT_ID: optionalPositiveInt,
  PLACEMENT_EVENT_SUBSCRIPTION_ID: stringWithDefault("sense-placement-status-sync"),
  PLACEMENT_EVENT_MAX_EVENTS: positiveIntWithDefault(100),
  PLACEMENT_DATABASE_ENRICHMENT_QUERY_COUNT: positiveIntWithDefault(200),
  PLACEMENT_DATABASE_ENRICHMENT_DAYS_BACK: positiveIntWithDefault(1),
  PLACEMENT_DATABASE_ENRICHMENT_EVENT_SUBSCRIPTION_ID: stringWithDefault(
    "sense-placement-database-enrichment-sync",
  ),
  PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS: positiveIntWithDefault(100),
  PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID: stringWithDefault(
    "sense-placement-termination-email",
  ),
  PLACEMENT_TERMINATION_EVENT_MAX_EVENTS: positiveIntWithDefault(100),
  INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID: stringWithDefault("sense-interview-illinois-email"),
  INTERVIEW_ILLINOIS_EVENT_MAX_EVENTS: positiveIntWithDefault(100),
  INTERVIEW_ILLINOIS_JOB_ORDER_STATE: stringWithDefaultPreserveBlank("Illinois"),
  INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED: stringWithDefaultPreserveBlank("2024-05-01"),
  INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: stringWithDefaultPreserveBlank("contract"),
  NEW_JOB_ILLINOIS_GRACE_HOURS: positiveIntWithDefault(24),
  NEW_JOB_ILLINOIS_QUERY_COUNT: positiveIntWithDefault(200),
  NEW_JOB_ILLINOIS_JOB_ORDER_STATE: stringWithDefaultPreserveBlank("Illinois"),
  NEW_JOB_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: stringWithDefaultPreserveBlank("contract"),
  PLACEMENT_START_REMINDER_DAYS_AHEAD: positiveIntWithDefault(4),
  PLACEMENT_START_REMINDER_QUERY_COUNT: positiveIntWithDefault(200),
  PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS: nonNegativeIntWithDefault(0),
  PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS: nonNegativeIntWithDefault(0),
  PLACEMENT_BENEFITS_REMINDER_QUERY_COUNT: positiveIntWithDefault(200),
  PLACEMENT_BENEFITS_REMINDER_TARGET_DATE: optionalString,
  PLACEMENT_BENEFITS_REMINDER_DAY10_SPARKPOST_TEMPLATE_ID: optionalString,
  PLACEMENT_BENEFITS_REMINDER_DAY21_SPARKPOST_TEMPLATE_ID: optionalString,
  PLACEMENT_BENEFITS_REMINDER_DAY26_SPARKPOST_TEMPLATE_ID: optionalString,
  US_CONTRACT_PERFORMANCE_CHECKIN_QUERY_COUNT: positiveIntWithDefault(200),
  HARASSMENT_TRAINING_QUERY_COUNT: positiveIntWithDefault(200),
  HARASSMENT_TRAINING_TARGET_DATE: optionalString,
  HARASSMENT_TRAINING_EXTRA_DATE_BEGIN_STATUSES: stringWithDefaultPreserveBlank(""),
  HARASSMENT_TRAINING_SPARKPOST_TEMPLATE_ID: optionalString,
  HARASSMENT_TRAINING_ONBOARDING_SPARKPOST_TEMPLATE_ID: optionalString,
  HARASSMENT_TRAINING_STATE_NOTICE_SPARKPOST_TEMPLATE_ID: optionalString,
  HARASSMENT_TRAINING_CALIFORNIA_SPARKPOST_TEMPLATE_ID: optionalString,
  HARASSMENT_TRAINING_FALLBACK_FROM_EMAIL: optionalString,
  HARASSMENT_TRAINING_FLAG_FIELDS: stringWithDefaultPreserveBlank(""),
  HARASSMENT_TRAINING_RESPONSE_TABLE_NAME: stringWithDefault("HarassmentTrainingResponses"),
  HARASSMENT_TRAINING_RESPONSE_BASE_URL: optionalString,
  HARASSMENT_TRAINING_RESPONSE_SIGNING_SECRET: optionalString,
  HARASSMENT_TRAINING_ILLINOIS_ATTACHMENT_PATH: optionalString,
  HARASSMENT_TRAINING_MAINE_ATTACHMENT_PATH: optionalString,
  HARASSMENT_TRAINING_CONNECTICUT_ATTACHMENT_PATH: optionalString,
  HARASSMENT_TRAINING_NEW_YORK_ATTACHMENT_PATH: optionalString,
  HARASSMENT_TRAINING_CALIFORNIA_ATTACHMENT_PATH: optionalString,
  PLACEMENT_YEARLY_FEE_INCREASE_MONTH_OFFSET: nonNegativeIntWithDefault(11),
  PLACEMENT_YEARLY_FEE_INCREASE_QUERY_COUNT: positiveIntWithDefault(200),
  PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_BEFORE_DAYS: nonNegativeIntWithDefault(0),
  PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_AFTER_DAYS: nonNegativeIntWithDefault(0),
  PLACEMENT_YEARLY_FEE_INCREASE_TEST_MODE: envBoolean,
  BULLHORN_WORKFLOW: optionalString,
  BULLHORN_EMAIL_TRACKING_BCC: optionalString,
  SPARKPOST_API_BASE_URL: urlWithDefault("https://api.sparkpost.com"),
  SPARKPOST_API_KEY: optionalString,
  SPARKPOST_TEMPLATE_ID: optionalString,
  INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID: optionalString,
  NEW_JOB_ILLINOIS_SPARKPOST_TEMPLATE_ID: optionalString,
  PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID: optionalString,
  PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID: optionalString,
  PLACEMENT_TERMINATION_TEST_RECIPIENT_EMAIL: optionalString,
  PLACEMENT_TERMINATION_TEST_OWNER_FIRST_NAME: optionalString,
  PLACEMENT_TERMINATION_TEST_OWNER_LAST_NAME: optionalString,
  PLACEMENT_TERMINATION_TEST_CANDIDATE_NAME: optionalString,
  PLACEMENT_TERMINATION_TEST_PLACEMENT_ID: optionalString,
  PLACEMENT_TERMINATION_TEST_CLIENT_COMPANY_NAME: optionalString,
  PLACEMENT_TERMINATION_TEST_JOB_TITLE: optionalString,
  PLACEMENT_TERMINATION_TEST_DATE_BEGIN: optionalString,
  PLACEMENT_TERMINATION_TEST_DATE_END: optionalString,
  PLACEMENT_TERMINATION_WORKFLOWS_QUERY_COUNT: positiveIntWithDefault(200),
  PLACEMENT_TERMINATION_WORKFLOWS_TARGET_DATE: optionalString,
  AMERICAS_ONBOARDING_NOTICES_QUERY_COUNT: positiveIntWithDefault(200),
  AMERICAS_ONBOARDING_NOTICES_TARGET_DATE: optionalString,
  AMERICAS_ONBOARDING_NOTICES_EXTRA_DATE_BEGIN_STATUSES: stringWithDefaultPreserveBlank(""),
  AMERICAS_INTERNAL_PLACEMENT_NOTICES_QUERY_COUNT: positiveIntWithDefault(200),
  AMERICAS_INTERNAL_PLACEMENT_NOTICES_TARGET_DATE: optionalString,
  AIS_SURVIVEX_CERTIFICATION_QUERY_COUNT: positiveIntWithDefault(200),
  AIS_SURVIVEX_CERTIFICATION_TARGET_DATE: optionalString,
  AIS_SURVIVEX_CERTIFICATION_ENTITY_NAME: stringWithDefault("CandidateCertification"),
  AMERICAS_WELCOME_CONTRACT_EMAIL_QUERY_COUNT: positiveIntWithDefault(200),
  AMERICAS_WELCOME_CONTRACT_EMAIL_TARGET_DATE: optionalString,
  AMERICAS_WELCOME_CONTRACT_EMAIL_ACTION_TYPE_FIELD: stringWithDefault("customText16"),
  PERM_CHECKIN_QUERY_COUNT: positiveIntWithDefault(200),
  PERM_CHECKIN_TARGET_DATE: optionalString,
  PERM_CHECKIN_RESPONSE_BASE_URL: optionalString,
  EMEA_PLACEMENT_AUTO_REPLY_QUERY_COUNT: positiveIntWithDefault(200),
  EMEA_PLACEMENT_AUTO_REPLY_TARGET_DATE: optionalString,
  SO_HOW_DID_WE_DO_QUERY_COUNT: positiveIntWithDefault(200),
  SO_HOW_DID_WE_DO_TARGET_DATE: optionalString,
  POSTGRES_CONNECTION_STRING: optionalString,
  START_DATE_APPROVAL_REMINDER_QUERY_COUNT: positiveIntWithDefault(200),
  START_DATE_APPROVAL_REMINDER_TARGET_DATE: optionalString,
  AZURE_TABLE_STORAGE_CONNECTION_STRING: optionalString,
  AZURE_TABLE_STORAGE_TABLE_NAME: stringWithDefault("WorkflowRunLogs"),
  AZURE_WORKFLOW_DASHBOARD_BY_DAY_TABLE_NAME: stringWithDefault("WorkflowDashboardByDay"),
  AZURE_WORKFLOW_DASHBOARD_BY_WORKFLOW_TABLE_NAME: stringWithDefault("WorkflowDashboardByWorkflow"),
  AZURE_WORKFLOW_RETENTION_DAYS: positiveIntWithDefault(60),
  AZURE_WORKFLOW_SEND_LOCK_TABLE_NAME: stringWithDefault("WorkflowSendLocks"),
  WORKFLOW_SURVEY_RESPONSE_TABLE_NAME: stringWithDefault("WorkflowSurveyResponses"),
  WORKFLOW_SURVEY_TRACKING_TABLE_NAME: stringWithDefault("WorkflowSurveyTracking"),
  WORKFLOW_SURVEY_RESPONSE_BASE_URL: optionalString,
  WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET: optionalString,
  AZURE_PLACEMENT_DATABASE_ENRICHMENT_COMPARISON_TABLE_NAME: stringWithDefault(
    "PlacementDatabaseEnrichmentComparisonRecords",
  ),
  DAILY_SUMMARY_RECIPIENT_EMAIL: optionalString,
  DAILY_SUMMARY_FROM_EMAIL: optionalString,
  AZURE_DAILY_WORKFLOW_SUMMARY_SCHEDULE: stringWithDefault("0 55 23 * * *"),
  AZURE_DAILY_WORKFLOW_COMPARISON_SUMMARY_SCHEDULE: stringWithDefault("0 50 23 * * *"),
  AZURE_WORKFLOW_RETENTION_CLEANUP_SCHEDULE: stringWithDefault("0 45 23 * * *"),
  RETRY_MAX_ATTEMPTS: positiveIntWithDefault(4),
  RETRY_BASE_DELAY_MS: positiveIntWithDefault(500),
  UPDATE_DELAY_MS: nonNegativeIntWithDefault(150),
});

function applyBullhornEnvironment(env) {
  const selectedEnvironment = (env.BULLHORN_ENV || "production").trim().toUpperCase();
  const prefix = `BULLHORN_${selectedEnvironment}_`;
  const mappedEnv = { ...env };

  const environmentSpecificFieldNames = [
    "CLIENT_ID",
    "CLIENT_SECRET",
    "USERNAME",
    "PASSWORD",
    "API_BASE_URL",
    "API_VERSION",
  ];

  for (const fieldName of environmentSpecificFieldNames) {
    const prefixedKey = `${prefix}${fieldName}`;
    const baseKey = `BULLHORN_${fieldName}`;
    if (mappedEnv[prefixedKey] !== undefined && mappedEnv[prefixedKey] !== "") {
      mappedEnv[baseKey] = mappedEnv[prefixedKey];
    }
  }

  if (
    (mappedEnv.BULLHORN_AUTH_BASE_URL === undefined || mappedEnv.BULLHORN_AUTH_BASE_URL === "") &&
    mappedEnv[`${prefix}AUTH_BASE_URL`] !== undefined &&
    mappedEnv[`${prefix}AUTH_BASE_URL`] !== ""
  ) {
    mappedEnv.BULLHORN_AUTH_BASE_URL = mappedEnv[`${prefix}AUTH_BASE_URL`];
  }

  if (
    (mappedEnv.BULLHORN_REDIRECT_URI === undefined || mappedEnv.BULLHORN_REDIRECT_URI === "") &&
    mappedEnv[`${prefix}REDIRECT_URI`] !== undefined &&
    mappedEnv[`${prefix}REDIRECT_URI`] !== ""
  ) {
    mappedEnv.BULLHORN_REDIRECT_URI = mappedEnv[`${prefix}REDIRECT_URI`];
  }

  const sharedEnvironmentOverrides = [
    "PLACEMENT_START_REMINDER_DAYS_AHEAD",
    "PLACEMENT_START_REMINDER_QUERY_COUNT",
    "PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS",
    "PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS",
  ];

  for (const key of sharedEnvironmentOverrides) {
    const prefixedKey = `${prefix}${key}`;
    if (mappedEnv[prefixedKey] !== undefined && mappedEnv[prefixedKey] !== "") {
      mappedEnv[key] = mappedEnv[prefixedKey];
    }
  }

  return mappedEnv;
}

function loadConfig() {
  const env = applyBullhornEnvironment({ ...process.env });
  env.SPARKPOST_API_KEY = env.SPARKPOST_API_KEY || env.BULLHORN_WORKFLOW;

  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment config:\n${details.join("\n")}`);
  }

  return parsed.data;
}

module.exports = { applyBullhornEnvironment, loadConfig };
