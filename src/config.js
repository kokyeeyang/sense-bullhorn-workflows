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

const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());

const urlWithDefault = (defaultValue) =>
  z.preprocess(emptyStringToUndefined, z.string().url().default(defaultValue));

const stringWithDefault = (defaultValue) =>
  z.preprocess(emptyStringToUndefined, z.string().default(defaultValue));

const positiveIntWithDefault = (defaultValue) =>
  z.preprocess(emptyStringToUndefined, z.coerce.number().int().positive().default(defaultValue));

const nonNegativeIntWithDefault = (defaultValue) =>
  z.preprocess(emptyStringToUndefined, z.coerce.number().int().min(0).default(defaultValue));

const configSchema = z.object({
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
  RETRY_MAX_ATTEMPTS: positiveIntWithDefault(4),
  RETRY_BASE_DELAY_MS: positiveIntWithDefault(500),
  UPDATE_DELAY_MS: nonNegativeIntWithDefault(150),
});

function loadConfig() {
  const parsed = configSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment config:\n${details.join("\n")}`);
  }

  return parsed.data;
}

module.exports = { loadConfig };
