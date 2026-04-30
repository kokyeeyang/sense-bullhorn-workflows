const { applyBullhornEnvironment } = require("../src/helpers/config");

describe("config environment selection", () => {
  test("uses production Bullhorn variables when BULLHORN_ENV=production", () => {
    expect(
      applyBullhornEnvironment({
        BULLHORN_ENV: "production",
        BULLHORN_AUTH_BASE_URL: "https://shared-auth.example.com",
        BULLHORN_REDIRECT_URI: "https://shared.example.com/callback",
        BULLHORN_PRODUCTION_CLIENT_ID: "prod-client-id",
        BULLHORN_PRODUCTION_CLIENT_SECRET: "prod-secret",
        BULLHORN_PRODUCTION_USERNAME: "prod-user",
        BULLHORN_PRODUCTION_PASSWORD: "prod-pass",
        BULLHORN_PRODUCTION_API_BASE_URL: "https://prod-api.example.com",
        BULLHORN_PRODUCTION_API_VERSION: "v1",
      }),
    ).toMatchObject({
      BULLHORN_CLIENT_ID: "prod-client-id",
      BULLHORN_CLIENT_SECRET: "prod-secret",
      BULLHORN_USERNAME: "prod-user",
      BULLHORN_PASSWORD: "prod-pass",
      BULLHORN_AUTH_BASE_URL: "https://shared-auth.example.com",
      BULLHORN_API_BASE_URL: "https://prod-api.example.com",
      BULLHORN_REDIRECT_URI: "https://shared.example.com/callback",
      BULLHORN_API_VERSION: "v1",
    });
  });

  test("uses staging Bullhorn variables when BULLHORN_ENV=staging", () => {
    expect(
      applyBullhornEnvironment({
        BULLHORN_ENV: "staging",
        BULLHORN_AUTH_BASE_URL: "https://shared-auth.example.com",
        BULLHORN_REDIRECT_URI: "https://shared.example.com/callback",
        BULLHORN_STAGING_CLIENT_ID: "stage-client-id",
        BULLHORN_STAGING_CLIENT_SECRET: "stage-secret",
        BULLHORN_STAGING_USERNAME: "stage-user",
        BULLHORN_STAGING_PASSWORD: "stage-pass",
        BULLHORN_STAGING_API_BASE_URL: "https://stage-api.example.com",
        BULLHORN_STAGING_API_VERSION: "*",
      }),
    ).toMatchObject({
      BULLHORN_CLIENT_ID: "stage-client-id",
      BULLHORN_CLIENT_SECRET: "stage-secret",
      BULLHORN_USERNAME: "stage-user",
      BULLHORN_PASSWORD: "stage-pass",
      BULLHORN_AUTH_BASE_URL: "https://shared-auth.example.com",
      BULLHORN_API_BASE_URL: "https://stage-api.example.com",
      BULLHORN_REDIRECT_URI: "https://shared.example.com/callback",
      BULLHORN_API_VERSION: "*",
    });
  });

  test("falls back to prefixed auth and redirect values when shared values are absent", () => {
    expect(
      applyBullhornEnvironment({
        BULLHORN_ENV: "staging",
        BULLHORN_STAGING_CLIENT_ID: "stage-client-id",
        BULLHORN_STAGING_CLIENT_SECRET: "stage-secret",
        BULLHORN_STAGING_USERNAME: "stage-user",
        BULLHORN_STAGING_PASSWORD: "stage-pass",
        BULLHORN_STAGING_AUTH_BASE_URL: "https://stage-auth.example.com",
        BULLHORN_STAGING_REDIRECT_URI: "https://stage.example.com/callback",
      }),
    ).toMatchObject({
      BULLHORN_CLIENT_ID: "stage-client-id",
      BULLHORN_AUTH_BASE_URL: "https://stage-auth.example.com",
      BULLHORN_REDIRECT_URI: "https://stage.example.com/callback",
    });
  });

  test("preserves base Bullhorn variables when no prefixed override exists", () => {
    expect(
      applyBullhornEnvironment({
        BULLHORN_ENV: "production",
        BULLHORN_CLIENT_ID: "base-client-id",
        BULLHORN_CLIENT_SECRET: "base-secret",
        BULLHORN_USERNAME: "base-user",
        BULLHORN_PASSWORD: "base-pass",
        BULLHORN_REDIRECT_URI: "https://base.example.com/callback",
      }),
    ).toMatchObject({
      BULLHORN_CLIENT_ID: "base-client-id",
      BULLHORN_CLIENT_SECRET: "base-secret",
      BULLHORN_USERNAME: "base-user",
      BULLHORN_PASSWORD: "base-pass",
      BULLHORN_REDIRECT_URI: "https://base.example.com/callback",
    });
  });

  test("uses environment-specific placement start reminder windows", () => {
    expect(
      applyBullhornEnvironment({
        BULLHORN_ENV: "staging",
        PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS: "0",
        PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS: "0",
        BULLHORN_STAGING_PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS: "730",
        BULLHORN_STAGING_PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS: "730",
      }),
    ).toMatchObject({
      PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS: "730",
      PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS: "730",
    });
  });

  test("preserves blank Illinois interview filters so they can be disabled explicitly", () => {
    const { loadConfig } = require("../src/helpers/config");

    const originalEnv = process.env;
    process.env = {
      BULLHORN_ENV: "production",
      BULLHORN_CLIENT_ID: "client-id",
      BULLHORN_CLIENT_SECRET: "client-secret",
      BULLHORN_USERNAME: "username",
      BULLHORN_PASSWORD: "password",
      BULLHORN_REDIRECT_URI: "https://example.com/callback",
      INTERVIEW_ILLINOIS_JOB_ORDER_STATE: "",
      INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED: "",
      INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "",
    };

    try {
      const config = loadConfig();
      expect(config.INTERVIEW_ILLINOIS_JOB_ORDER_STATE).toBe("");
      expect(config.INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED).toBe("");
      expect(config.INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE).toBe("");
    } finally {
      process.env = originalEnv;
    }
  });
});
