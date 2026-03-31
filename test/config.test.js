const { applyBullhornEnvironment } = require("../src/config");

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
});
