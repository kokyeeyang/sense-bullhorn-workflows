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
  CLIENT_CORPORATION_360_CUTOFF_DATE: stringWithDefault("2023-12-01"),
  CLIENT_CORPORATION_360_DELAY_HOURS: positiveIntWithDefault(24),
  CLIENT_CORPORATION_KEY_ACCOUNT_CUTOFF_DATE: stringWithDefault("2024-01-01"),
  CLIENT_CORPORATION_KEY_ACCOUNT_DELAY_HOURS: positiveIntWithDefault(24),
  DRY_RUN: envBoolean,
  TEST_CANDIDATE_ID: optionalPositiveInt,
  TEST_CLIENT_CORPORATION_ID: optionalPositiveInt,
  PLACEMENT_EVENT_SUBSCRIPTION_ID: stringWithDefault("sense-placement-status-sync"),
  PLACEMENT_EVENT_MAX_EVENTS: positiveIntWithDefault(100),
  PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID: stringWithDefault(
    "sense-placement-termination-email",
  ),
  PLACEMENT_TERMINATION_EVENT_MAX_EVENTS: positiveIntWithDefault(100),
  INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID: stringWithDefault("sense-interview-illinois-email"),
  INTERVIEW_ILLINOIS_EVENT_MAX_EVENTS: positiveIntWithDefault(100),
  INTERVIEW_ILLINOIS_JOB_ORDER_STATE: stringWithDefaultPreserveBlank("Illinois"),
  INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED: stringWithDefaultPreserveBlank("2024-05-01"),
  INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: stringWithDefaultPreserveBlank("contract"),
  PLACEMENT_START_REMINDER_DAYS_AHEAD: positiveIntWithDefault(4),
  PLACEMENT_START_REMINDER_QUERY_COUNT: positiveIntWithDefault(200),
  PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS: nonNegativeIntWithDefault(0),
  PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS: nonNegativeIntWithDefault(0),
  SPARKPOST_API_BASE_URL: urlWithDefault("https://api.sparkpost.com"),
  SPARKPOST_API_KEY: optionalString,
  SPARKPOST_TEMPLATE_ID: optionalString,
  INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID: optionalString,
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
  if (!env.SPARKPOST_API_KEY && env.BULLHORN_WORKFLOW) {
    env.SPARKPOST_API_KEY = env.BULLHORN_WORKFLOW;
  }

  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment config:\n${details.join("\n")}`);
  }

  return parsed.data;
}

module.exports = { applyBullhornEnvironment, loadConfig };
