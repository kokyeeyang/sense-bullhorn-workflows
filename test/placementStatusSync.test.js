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
  upsertEventSubscription: jest.fn(),
  consumeEvents: jest.fn(),
  getPlacementStatusChange: jest.fn(),
  getPlacement: jest.fn(),
  updateCandidate: jest.fn(),
};

jest.mock("../src/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/config");
const { run } = require("../src/placementStatusSync");

describe("placementStatusSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: false,
      PLACEMENT_EVENT_SUBSCRIPTION_ID: "sense-placement-status-sync",
      PLACEMENT_EVENT_MAX_EVENTS: 100,
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
    mockBullhornClient.upsertEventSubscription.mockResolvedValue({});
  });

  test("updates candidate when placement transitions from qc approved to approved", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({
      events: [
        {
          entityId: 321,
          transactionID: 999,
          updatedProperties: ["status"],
        },
      ],
    });
    mockBullhornClient.getPlacementStatusChange.mockResolvedValue({
      oldValue: "qc approved",
      newValue: "approved",
    });
    mockBullhornClient.getPlacement.mockResolvedValue({
      id: 321,
      payRate: 42.5,
      dateEnd: 1_700_000_000_000,
      candidate: {
        id: 123,
        companyName: "Old Corp",
        occupation: "Old Title",
        status: "Available",
        dateAvailable: 1_699_900_000_000,
        hourlyRateLow: 30,
      },
      clientCorporation: { name: "Acme Corp" },
      jobOrder: { title: "QA Analyst" },
    });

    await run();

    expect(mockBullhornClient.updateCandidate).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      candidateId: 123,
      patch: {
        companyName: "Acme Corp",
        occupation: "QA Analyst",
        status: "Placed by us",
        hourlyRateLow: 42.5,
        dateAvailable: 1_700_086_400_000,
      },
    });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(mockBullhornClient.getPlacementStatusChange).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      transactionId: 999,
    });
  });

  test("skips candidate update when status transition does not match", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({
      events: [
        {
          entityId: 321,
          transactionID: 999,
          updatedProperties: ["status"],
        },
      ],
    });
    mockBullhornClient.getPlacementStatusChange.mockResolvedValue({
      oldValue: "submitted",
      newValue: "approved",
    });

    await run();

    expect(mockBullhornClient.getPlacement).not.toHaveBeenCalled();
    expect(mockBullhornClient.updateCandidate).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });
});
