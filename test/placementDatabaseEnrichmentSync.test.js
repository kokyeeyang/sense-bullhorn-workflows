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
  upsertEventSubscription: jest.fn(),
  consumeEvents: jest.fn(),
  getPlacementStatusChange: jest.fn(),
  getPlacement: jest.fn(),
  getPlacementByIdWithFields: jest.fn(),
  queryPlacementsByDateAddedRange: jest.fn(),
  updateCandidate: jest.fn(),
  updateClientCorporation: jest.fn(),
};

jest.mock("../src/clients/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/helpers/config");
const { run } = require("../src/workflows/placementDatabaseEnrichmentSync");

describe("placementDatabaseEnrichmentSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: false,
      PLACEMENT_DATABASE_ENRICHMENT_EVENT_SUBSCRIPTION_ID:
        "sense-placement-database-enrichment-sync",
      PLACEMENT_DATABASE_ENRICHMENT_EVENT_MAX_EVENTS: 100,
      PLACEMENT_DATABASE_ENRICHMENT_DATE_ADDED_QUERY_COUNT: 200,
      PLACEMENT_DATABASE_ENRICHMENT_CANDIDATE_OWNER_MIN_DATE_ADDED: "2025-01-01",
      PLACEMENT_DATABASE_ENRICHMENT_PO_CLIENT_FIELD: "customText10",
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
    mockBullhornClient.upsertEventSubscription.mockResolvedValue({
      subscriptionId: "sense-placement-database-enrichment-sync",
    });
    mockBullhornClient.queryPlacementsByDateAddedRange.mockResolvedValue([]);
  });

  test("updates candidates for matched placement events using the correct branch rules", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({
      events: [
        {
          entityId: 321,
          transactionID: "tx-1",
          updatedProperties: ["status"],
        },
        {
          entityId: 322,
          transactionID: "tx-2",
          updatedProperties: ["status"],
        },
        {
          entityId: 323,
          transactionID: "tx-3",
          updatedProperties: ["status"],
        },
        {
          entityId: 324,
          transactionID: "tx-4",
          updatedProperties: ["dateEnd"],
        },
      ],
    });

    mockBullhornClient.getPlacementStatusChange
      .mockResolvedValueOnce({
        oldValue: null,
        newValue: "approved",
      })
      .mockResolvedValueOnce({
        oldValue: null,
        newValue: "approved",
      })
      .mockResolvedValueOnce({
        oldValue: "rejected",
        newValue: "approved",
      });

    mockBullhornClient.getPlacementByIdWithFields
      .mockResolvedValueOnce({
        id: 321,
        status: "approved",
        employmentType: "perm",
        dateBegin: "2099-05-01T00:00:00.000Z",
        dateLastModified: "2026-04-13T03:00:00.000Z",
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
        dateEnd: 4_102_444_800_000,
        dateLastModified: "2026-04-13T05:00:00.000Z",
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
      })
      .mockResolvedValueOnce({
        id: 323,
        status: "approved",
        employmentType: "contract",
        dateLastModified: "2026-04-12T05:00:00.000Z",
        candidate: {
          id: 125,
          companyName: "Skip Corp",
          occupation: "Skip Occupation",
          status: "Available",
        },
        clientCorporation: { name: "Gamma Corp" },
        jobOrder: { title: "Inspector" },
      })
      .mockResolvedValueOnce({
        id: 324,
        status: "approved",
        employmentType: "contract",
        dateEnd: "2000-01-01T00:00:00.000Z",
        dateLastModified: "2026-04-13T05:00:00.000Z",
        candidate: {
          id: 126,
          companyName: "Finished Corp",
          occupation: "Finished Occupation",
          status: "Placed by us",
        },
        clientCorporation: { name: "Delta Corp" },
        jobOrder: { title: "Finished Role" },
      });

    const result = await run();

    expect(mockBullhornClient.upsertEventSubscription).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      subscriptionId: "sense-placement-database-enrichment-sync",
      entityName: "Placement",
    });
    expect(mockBullhornClient.consumeEvents).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      subscriptionId: "sense-placement-database-enrichment-sync",
      maxEvents: 100,
    });
    expect(mockBullhornClient.updateCandidate).toHaveBeenCalledTimes(3);
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
        dateAvailable: 4_102_531_200_000,
      },
    });
    expect(mockBullhornClient.updateCandidate).toHaveBeenNthCalledWith(3, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      candidateId: 126,
      patch: {
        status: "Active",
      },
    });
    expect(result.report.totals).toEqual({
      totalEvents: 4,
      matchedPlacements: 4,
      dateAddedPlacements: 0,
      affectedCandidates: 3,
      affectedClientCorporations: 0,
      updated: 3,
      updatedCandidateOwners: 0,
      updatedClientCorporations: 0,
      skippedMissingPlacementId: 0,
      skippedPlacementNotFound: 0,
      skippedMissingTransactionId: 0,
      skippedNotEligible: 1,
      skippedDuplicatePlacement: 0,
      skippedNoPatch: 0,
      skippedNoChange: 0,
      skippedCandidateOwnerNoPatch: 0,
      skippedCandidateOwnerNoChange: 0,
      skippedClientCorporationPoFieldNotConfigured: 0,
      skippedClientCorporationPoNoPatch: 3,
    });
    expect(result.report.skippedPlacements).toEqual([
      {
        placementId: 323,
        transactionId: "tx-3",
        updatedProperties: ["status"],
        dateLastModified: "2026-04-12T05:00:00.000Z",
        employmentType: "contract",
        oldValue: "rejected",
        newValue: "approved",
        reason: "placement-not-eligible-for-database-enrichment",
      },
    ]);
    expect(result.report.affectedCandidates[0]).toMatchObject({
      placementId: 321,
      candidateId: 123,
      mode: "updated",
      mappingType: "placement-database-enrichment",
      matchReason: "perm-approved-status-change",
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
    expect(result.report.affectedCandidates[1]).toMatchObject({
      placementId: 322,
      candidateId: 124,
      mode: "updated",
      mappingType: "placement-database-enrichment",
      matchReason: "contract-approved-status-change",
      ruleType: "non-perm-active-placement",
      transactionId: "tx-2",
    });
    expect(result.report.affectedCandidates[2]).toMatchObject({
      placementId: 324,
      candidateId: 126,
      mode: "updated",
      mappingType: "placement-database-enrichment",
      matchReason: "contract-placement-finished",
      ruleType: "contract-finished-placement",
      transactionId: "tx-4",
      changes: [
        {
          field: "status",
          oldValue: "Placed by us",
          newValue: "Active",
        },
      ],
    });
    expect(result.artifacts).toEqual(
      expect.objectContaining({
        reportPath: expect.stringContaining("placement-database-enrichment-report"),
        comparisonReportPath: expect.stringContaining(
          "placement-database-enrichment-comparison-report",
        ),
      }),
    );
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(fs.writeFile.mock.calls[1][1]).toContain("\"comparisonRecords\"");
    expect(fs.writeFile.mock.calls[1][1]).toContain("\"sourceSystem\": \"azure-functions\"");
  });

  test("skips placement events when Bullhorn no longer returns the placement", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({
      events: [
        {
          entityId: 999,
          transactionID: "tx-missing",
          updatedProperties: ["status"],
        },
      ],
    });
    mockBullhornClient.getPlacementByIdWithFields.mockRejectedValue({
      response: {
        status: 404,
        data: {
          errorMessage: "Entity not found.",
          errorMessageKey: "errors.entityNotFound",
          errorCode: 404,
        },
      },
    });

    const result = await run();

    expect(mockBullhornClient.getPlacementStatusChange).not.toHaveBeenCalled();
    expect(mockBullhornClient.updateCandidate).not.toHaveBeenCalled();
    expect(result.report.totals.skippedPlacementNotFound).toBe(1);
    expect(result.report.skippedPlacements).toEqual([
      {
        placementId: 999,
        transactionId: "tx-missing",
        updatedProperties: ["status"],
        reason: "placement-not-found",
      },
    ]);
  });
});
