const { z } = require("zod");

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

const configSchema = z.object({
  BULLHORN_CLIENT_ID: z.string().min(1),
  BULLHORN_CLIENT_SECRET: z.string().min(1),
  BULLHORN_USERNAME: z.string().min(1),
  BULLHORN_PASSWORD: z.string().min(1),
  BULLHORN_AUTH_BASE_URL: z.string().url().default("https://rest.bullhornstaffing.com"),
  BULLHORN_API_BASE_URL: z.string().url().optional(),
  BULLHORN_REDIRECT_URI: z.string().url(),
  BULLHORN_API_VERSION: z.string().default("*"),
  LOOKBACK_HOURS: z.coerce.number().int().positive().default(60),
  DRY_RUN: envBoolean,
  TEST_CANDIDATE_ID: z.coerce.number().int().positive().optional(),
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
