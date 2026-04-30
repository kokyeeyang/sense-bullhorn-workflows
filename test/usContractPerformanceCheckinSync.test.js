jest.mock("node:fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/helpers/config", () => ({
  loadConfig: jest.fn(),
}));

jest.mock("../src/helpers/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockBullhornClient = {
  getAuthorizationCode: jest.fn(),
  getAccessToken: jest.fn(),
  login: jest.fn(),
  queryPlacementsByDateBeginRange: jest.fn(),
  getCorporateUser: jest.fn(),
};

const mockSparkPostClient = {
  sendInlineTransmission: jest.fn(),
};

const mockReserveWorkflowSend = jest.fn();
const mockReleaseWorkflowSend = jest.fn();

jest.mock("../src/clients/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

jest.mock("../src/clients/sparkPostClient", () => ({
  SparkPostClient: jest.fn(() => mockSparkPostClient),
}));

jest.mock("../src/stores/workflowSendLockStore", () => ({
  reserveWorkflowSend: (...args) => mockReserveWorkflowSend(...args),
  releaseWorkflowSend: (...args) => mockReleaseWorkflowSend(...args),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/helpers/config");
const { run } = require("../src/workflows/usContractPerformanceCheckinSync");

describe("usContractPerformanceCheckinSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: true,
      US_CONTRACT_PERFORMANCE_CHECKIN_QUERY_COUNT: 200,
      SPARKPOST_API_KEY: "sparkpost-key",
      SPARKPOST_API_BASE_URL: "https://api.sparkpost.com",
      RETRY_MAX_ATTEMPTS: 4,
      RETRY_BASE_DELAY_MS: 500,
    });

    mockBullhornClient.getAuthorizationCode.mockResolvedValue("auth-code");
    mockBullhornClient.getAccessToken.mockResolvedValue("access-token");
    mockBullhornClient.login.mockResolvedValue({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
    });
    mockBullhornClient.getCorporateUser.mockImplementation(async ({ corporateUserId }) => ({
      id: corporateUserId,
      firstName: "Jordan",
      lastName: "Reed",
      email: "jordan@example.com",
      reportToPerson: { id: 991, email: "manager@example.com" },
    }));
  });

  test("builds check-in emails and does not send in dry run", async () => {
    mockBullhornClient.queryPlacementsByDateBeginRange
      .mockResolvedValueOnce([
        {
          id: 5001,
          status: "Approved",
          dateBegin: Date.UTC(2026, 3, 3),
          employmentType: "Contract",
          owner: { pager: "500" },
          candidate: { id: 7001, firstName: "Ava", lastName: "Tan" },
          clientContact: { id: 8001, firstName: "Maya", email: "maya@example.com" },
          clientCorporation: { id: 999, name: "Acme", customText16: "no" },
          jobOrder: { id: 9001, owner: { id: 901 } },
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await run({ targetDate: "2026-05-01" });

    expect(mockBullhornClient.queryPlacementsByDateBeginRange).toHaveBeenCalledTimes(2);
    expect(result.totals).toEqual({
      totalPlacementsQueried: 1,
      matchedPlacements: 1,
      skippedNonMatchingPlacement: 0,
      skippedMissingClientContactEmail: 0,
      skippedMissingJobOrderOwnerEmail: 0,
      skippedAlreadySent: 0,
      sendLockUnavailable: 0,
      skippedPreviewCount: 0,
    });
    expect(result.placements[0].recipient).toEqual({
      toEmail: "maya@example.com",
      ccEmails: ["manager@example.com"],
      fromEmail: "jordan@example.com",
      fromName: "Jordan Reed",
      missingClientContactEmail: false,
      missingJobOrderOwnerEmail: false,
    });
    expect(result.sparkPost.sent).toBe(false);
    expect(mockSparkPostClient.sendInlineTransmission).not.toHaveBeenCalled();
    expect(mockReserveWorkflowSend).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  test("reserves a send lock and skips placements that were already sent", async () => {
    loadConfig.mockReturnValue({
      DRY_RUN: false,
      US_CONTRACT_PERFORMANCE_CHECKIN_QUERY_COUNT: 200,
      SPARKPOST_API_KEY: "sparkpost-key",
      SPARKPOST_API_BASE_URL: "https://api.sparkpost.com",
      AZURE_TABLE_STORAGE_CONNECTION_STRING: "DefaultEndpointsProtocol=https;AccountName=test",
      AZURE_WORKFLOW_SEND_LOCK_TABLE_NAME: "WorkflowSendLocks",
      RETRY_MAX_ATTEMPTS: 4,
      RETRY_BASE_DELAY_MS: 500,
    });

    mockBullhornClient.queryPlacementsByDateBeginRange
      .mockResolvedValueOnce([
        {
          id: 5001,
          status: "Terminated",
          dateBegin: Date.UTC(2026, 3, 6),
          employmentType: "Permanent",
          owner: { pager: "100" },
          candidate: { id: 7001, firstName: "Ava", lastName: "Tan" },
          clientContact: { id: 8001, firstName: "Maya", email: "maya@example.com" },
          clientCorporation: { id: 142049, name: "Override", customText16: "yes" },
          jobOrder: { id: 9001, owner: { id: 901 } },
        },
        {
          id: 5002,
          status: "Approved",
          dateBegin: Date.UTC(2026, 3, 6),
          employmentType: "Contract",
          owner: { pager: "500" },
          candidate: { id: 7002, firstName: "Ben", lastName: "Lee" },
          clientContact: { id: 8002, firstName: "Nina", email: "nina@example.com" },
          clientCorporation: { id: 1000, name: "Standard", customText16: "no" },
          jobOrder: { id: 9002, owner: { id: 902 } },
        },
      ])
      .mockResolvedValueOnce([]);
    mockReserveWorkflowSend
      .mockResolvedValueOnce({ skipped: false, reserved: true, reason: "reserved" })
      .mockResolvedValueOnce({ skipped: false, reserved: false, reason: "already-reserved" });
    mockSparkPostClient.sendInlineTransmission.mockResolvedValue({ results: { id: "tx-1" } });

    const result = await run({ targetDate: "2026-05-04" });

    expect(mockReserveWorkflowSend).toHaveBeenCalledTimes(2);
    expect(mockSparkPostClient.sendInlineTransmission).toHaveBeenCalledTimes(1);
    expect(result.totals.matchedPlacements).toBe(1);
    expect(result.totals.skippedAlreadySent).toBe(1);
    expect(result.totals.skippedPreviewCount).toBe(1);
    expect(result.skippedPlacements[0]).toMatchObject({
      placementId: 5002,
      queryDateBegin: "2026-04-06",
      reason: "already-sent",
    });
    expect(result.sparkPost.sent).toBe(true);
  });

  test("includes skipped placement eligibility diagnostics", async () => {
    mockBullhornClient.queryPlacementsByDateBeginRange.mockResolvedValueOnce([
      {
        id: 5003,
        status: "Submitted",
        dateBegin: Date.UTC(2026, 3, 21),
        employmentType: "Permanent",
        owner: { pager: "100" },
        candidate: { id: 7003, firstName: "Chris", lastName: "Fox" },
        clientContact: { id: 8003, firstName: "Nora", email: "nora@example.com" },
        clientCorporation: { id: 142049, name: "Excluded", customText16: "no" },
        jobOrder: { id: 9003, owner: { id: 903 } },
      },
    ]);

    const result = await run({ targetDate: "2026-04-29" });

    expect(result.totals.matchedPlacements).toBe(0);
    expect(result.totals.skippedNonMatchingPlacement).toBe(1);
    expect(result.skippedPlacements).toHaveLength(1);
    expect(result.skippedPlacements[0]).toMatchObject({
      placementId: 5003,
      queryDateBegin: "2026-04-01",
      reason: "placement-not-eligible",
      matchDetails: {
        matched: false,
        failedStandardChecks: [
          "ownerPagerIs500",
          "employmentTypeAllowed",
          "clientCorporationAllowed",
          "statusAllowed",
        ],
      },
    });
  });
});
