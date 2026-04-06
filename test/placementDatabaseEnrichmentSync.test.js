jest.mock("node:fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/config", () => ({
  loadConfig: jest.fn(),
}));

jest.mock("../src/logger", () => ({
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
  queryPlacementEditHistoryByDateAddedRange: jest.fn(),
  getPlacement: jest.fn(),
  updateCandidate: jest.fn(),
};

jest.mock("../src/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/config");
const { run } = require("../src/placementDatabaseEnrichmentSync");

describe("placementDatabaseEnrichmentSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: false,
      PLACEMENT_DATABASE_ENRICHMENT_QUERY_COUNT: 200,
      PLACEMENT_DATABASE_ENRICHMENT_DAYS_BACK: 1,
      RETRY_MAX_ATTEMPTS: 4,
      RETRY_BASE_DELAY_MS: 500,
      UPDATE_DELAY_MS: 0,
    });

    mockBullhornClient.getAuthorizationCode.mockResolvedValue("auth-code");
    mockBullhornClient.getAccessToken.mockResolvedValue("access-token");
    mockBullhornClient.login.mockResolvedValue({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
    });
  });

  test("updates candidates for matched approved transitions using the correct branch rules", async () => {
    mockBullhornClient.queryPlacementEditHistoryByDateAddedRange.mockResolvedValue([
      {
        id: 7001,
        transactionID: "tx-1",
        targetEntity: { id: 321 },
        fieldChanges: [{ columnName: "status", oldValue: "submitted", newValue: "approved" }],
      },
      {
        id: 7002,
        transactionID: "tx-2",
        targetEntity: { id: 322 },
        fieldChanges: [{ columnName: "status", oldValue: null, newValue: "approved" }],
      },
      {
        id: 7003,
        transactionID: "tx-3",
        targetEntity: { id: 323 },
        fieldChanges: [{ columnName: "status", oldValue: "rejected", newValue: "approved" }],
      },
    ]);

    mockBullhornClient.getPlacement
      .mockResolvedValueOnce({
        id: 321,
        status: "approved",
        employmentType: "perm",
        dateBegin: "2099-05-01T00:00:00.000Z",
        candidate: {
          id: 123,
          companyName: "Old Corp",
          occupation: "Old Title",
          status: "Available",
        },
        clientCorporation: { name: "Acme Corp" },
        jobOrder: { title: "QA Analyst" },
      })
      .mockResolvedValueOnce({
        id: 322,
        status: "approved",
        employmentType: "contract",
        payRate: 42.5,
        dateEnd: 1_700_000_000_000,
        candidate: {
          id: 124,
          companyName: "Legacy LLC",
          occupation: "Old Occupation",
          status: "Available",
          dateAvailable: 1_699_900_000_000,
          hourlyRateLow: 30,
        },
        clientCorporation: { name: "Beta Corp" },
        jobOrder: { title: "Field Engineer" },
      });

    const result = await run();

    expect(mockBullhornClient.updateCandidate).toHaveBeenCalledTimes(2);
    expect(mockBullhornClient.updateCandidate).toHaveBeenNthCalledWith(1, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      candidateId: 123,
      patch: {
        companyName: "Acme Corp",
        occupation: "QA Analyst",
        status: "Placed by us",
      },
    });
    expect(mockBullhornClient.updateCandidate).toHaveBeenNthCalledWith(2, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      candidateId: 124,
      patch: {
        companyName: "Beta Corp",
        occupation: "Field Engineer",
        status: "Placed by us",
        hourlyRateLow: 42.5,
        dateAvailable: 1_700_086_400_000,
      },
    });
    expect(result.totals).toEqual({
      totalEditHistories: 3,
      matchedTransitions: 2,
      affectedCandidates: 2,
      updated: 2,
      skippedMissingPlacementId: 0,
      skippedWrongTransition: 1,
      skippedDuplicatePlacement: 0,
      skippedNoPatch: 0,
      skippedNoChange: 0,
    });
    expect(result.skippedTransitions).toEqual([
      {
        placementId: 323,
        editHistoryId: 7003,
        transactionId: "tx-3",
        dateAdded: null,
        oldValue: "rejected",
        newValue: "approved",
        reason: "status-transition-not-targeted",
      },
    ]);
    expect(result.affectedCandidates[0]).toMatchObject({
      placementId: 321,
      candidateId: 123,
      mode: "updated",
      mappingType: "placement-database-enrichment",
      ruleType: "perm-or-contract-to-perm",
      transactionId: "tx-1",
      placement: {
        status: "approved",
        employmentType: "perm",
        dateBegin: "2099-05-01T00:00:00.000Z",
        dateEnd: null,
        payRate: null,
        clientCorporationName: "Acme Corp",
        jobOrderTitle: "QA Analyst",
      },
      candidate: {
        companyName: "Old Corp",
        occupation: "Old Title",
        status: "Available",
        dateAvailable: null,
        hourlyRateLow: null,
      },
    });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });
});
