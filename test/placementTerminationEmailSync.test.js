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
  getCandidate: jest.fn(),
  getCorporateUser: jest.fn(),
};

const mockSparkPostClient = {
  sendTransmission: jest.fn(),
};

jest.mock("../src/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

jest.mock("../src/sparkPostClient", () => ({
  SparkPostClient: jest.fn(() => mockSparkPostClient),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/config");
const { getTemplateId, run } = require("../src/placementTerminationEmailSync");

describe("placementTerminationEmailSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: true,
      PLACEMENT_TERMINATION_EVENT_SUBSCRIPTION_ID: "sense-placement-termination-email",
      PLACEMENT_TERMINATION_EVENT_MAX_EVENTS: 100,
      PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID: "placement-terminated-template",
      SPARKPOST_TEMPLATE_ID: "fallback-template",
      SPARKPOST_API_KEY: "sparkpost-key",
      RETRY_MAX_ATTEMPTS: 4,
      RETRY_BASE_DELAY_MS: 500,
    });

    mockBullhornClient.getAuthorizationCode.mockResolvedValue("auth-code");
    mockBullhornClient.getAccessToken.mockResolvedValue("access-token");
    mockBullhornClient.login.mockResolvedValue({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
    });
    mockBullhornClient.upsertEventSubscription.mockResolvedValue({});
  });

  test("prefers the dedicated termination template id", () => {
    expect(
      getTemplateId({
        PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID: "terminated-template",
        SPARKPOST_TEMPLATE_ID: "fallback-template",
      }),
    ).toBe("terminated-template");
  });

  test("builds one SparkPost recipient per terminated placement and does not send in dry run", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({
      events: [
        {
          entityId: 321,
          transactionID: 999,
          updatedProperties: ["status"],
        },
        {
          entityId: 322,
          transactionID: 1000,
          updatedProperties: ["status"],
        },
      ],
    });
    mockBullhornClient.getPlacementStatusChange
      .mockResolvedValueOnce({
        oldValue: "approved",
        newValue: "terminated",
      })
      .mockResolvedValueOnce({
        oldValue: "approved",
        newValue: "completed",
      });
    mockBullhornClient.getPlacement.mockResolvedValue({
      id: 321,
      status: "Terminated",
      dateBegin: 1774828800000,
      dateEnd: 1775260800000,
      candidate: {
        id: 123,
        firstName: "Sammy",
        lastName: "Thackeray",
      },
      clientCorporation: { name: "Acme Corp" },
      jobOrder: {
        title: "QA Analyst",
        owner: { firstName: "Olivia", lastName: "Stone" },
      },
    });
    mockBullhornClient.getCandidate.mockResolvedValue({
      id: 123,
      firstName: "Sammy",
      lastName: "Thackeray",
      email: "sammy@example.com",
      owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
    });
    mockBullhornClient.getCorporateUser.mockResolvedValue({
      id: 2906869,
      firstName: "Jazzey",
      lastName: "Rooney",
      email: "owner@example.com",
    });

    const report = await run();

    expect(mockBullhornClient.upsertEventSubscription).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      subscriptionId: "sense-placement-termination-email",
      entityName: "Placement",
    });
    expect(mockBullhornClient.consumeEvents).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      subscriptionId: "sense-placement-termination-email",
      maxEvents: 100,
    });
    expect(report.totals).toEqual({
      totalEvents: 2,
      matchedPlacements: 1,
      recipients: 1,
      skippedNoStatusChange: 0,
      skippedWrongTransition: 1,
      skippedMissingOwnerEmail: 0,
      skippedDuplicatePlacement: 0,
    });
    expect(report.skippedEvents).toEqual([
      {
        placementId: 322,
        transactionId: 1000,
        updatedProperties: ["status"],
        reason: "status-change-not-terminated",
        statusChange: {
          oldValue: "approved",
          newValue: "completed",
        },
      },
    ]);
    expect(report.sparkPost.payload).toEqual({
      content: {
        template_id: "placement-terminated-template",
      },
      recipients: [
        {
          address: {
            email: "owner@example.com",
          },
          substitution_data: {
            owner_firstName: "Jazzey",
            placement_id: "321",
            placement_status: "Terminated",
            candidate_name: "Sammy Thackeray",
            candidate_email: "sammy@example.com",
            client_company_name: "Acme Corp",
            job_title: "QA Analyst",
            date_begin: "30 March 2026",
            date_end: "4 April 2026",
          },
        },
      ],
    });
    expect(mockSparkPostClient.sendTransmission).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  test("falls back to current placement status when a status event has no transaction id", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({
      events: [
        {
          entityId: 321,
          updatedProperties: ["status"],
        },
      ],
    });
    mockBullhornClient.getPlacement.mockResolvedValue({
      id: 321,
      status: "Terminated",
      dateBegin: 1774828800000,
      dateEnd: 1775260800000,
      candidate: {
        id: 123,
        firstName: "Sammy",
        lastName: "Thackeray",
      },
      clientCorporation: { name: "Acme Corp" },
      jobOrder: {
        title: "QA Analyst",
      },
    });
    mockBullhornClient.getCandidate.mockResolvedValue({
      id: 123,
      firstName: "Sammy",
      lastName: "Thackeray",
      email: "sammy@example.com",
      owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
    });
    mockBullhornClient.getCorporateUser.mockResolvedValue({
      id: 2906869,
      firstName: "Jazzey",
      lastName: "Rooney",
      email: "owner@example.com",
    });

    const report = await run();

    expect(mockBullhornClient.getPlacementStatusChange).not.toHaveBeenCalled();
    expect(report.totals).toEqual({
      totalEvents: 1,
      matchedPlacements: 1,
      recipients: 1,
      skippedNoStatusChange: 0,
      skippedWrongTransition: 0,
      skippedMissingOwnerEmail: 0,
      skippedDuplicatePlacement: 0,
    });
    expect(report.placements[0]).toMatchObject({
      placementId: 321,
      transactionId: null,
      statusChange: null,
    });
    expect(report.sparkPost.payload.recipients[0]).toMatchObject({
      address: {
        email: "owner@example.com",
      },
      substitution_data: {
        placement_id: "321",
        placement_status: "Terminated",
      },
    });
  });
});
