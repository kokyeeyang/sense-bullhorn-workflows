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
  getCandidate: jest.fn(),
  getCorporateUser: jest.fn(),
};

const mockSparkPostClient = {
  sendTransmission: jest.fn(),
};

jest.mock("../src/clients/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

jest.mock("../src/clients/sparkPostClient", () => ({
  SparkPostClient: jest.fn(() => mockSparkPostClient),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/helpers/config");
const { buildUtcDayWindow, run } = require("../src/workflows/placementStartReminderSync");

describe("placementStartReminderSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: true,
      PLACEMENT_START_REMINDER_DAYS_AHEAD: 4,
      PLACEMENT_START_REMINDER_QUERY_COUNT: 200,
      PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS: 0,
      PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS: 0,
      SPARKPOST_API_KEY: "sparkpost-key",
      SPARKPOST_TEMPLATE_ID: "template-123",
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
  });

  test("builds a UTC day window for the target date", () => {
    const window = buildUtcDayWindow({
      baseDate: new Date("2026-03-26T15:45:00.000Z"),
      daysAhead: 4,
      windowBeforeDays: 0,
      windowAfterDays: 0,
    });

    expect(window).toEqual({
      startMs: 1774828800000,
      endMs: 1774915200000,
      targetDate: "2026-03-30",
      windowBeforeDays: 0,
      windowAfterDays: 0,
    });
  });

  test("expands the query window when before and after days are provided", () => {
    const window = buildUtcDayWindow({
      baseDate: new Date("2026-03-26T15:45:00.000Z"),
      daysAhead: 4,
      windowBeforeDays: 7,
      windowAfterDays: 3,
    });

    expect(window).toEqual({
      startMs: 1774224000000,
      endMs: 1775174400000,
      targetDate: "2026-03-30",
      windowBeforeDays: 7,
      windowAfterDays: 3,
    });
  });

  test("builds one SparkPost recipient per placement and does not send in dry run", async () => {
    mockBullhornClient.queryPlacementsByDateBeginRange.mockResolvedValue([
      {
        id: 49086,
        customText8: "Yes",
        customText18: "PO-123",
        customText60: "SO Italy",
        candidate: { id: 516238, firstName: "Sammy", lastName: "Thackeray" },
        clientCorporation: {
          id: 9,
          name: "Bubbles Oil",
          customText2: "Agreed",
          customText10: "Yes",
          customText11: "Spencer Ogden Ltd",
        },
        billingClientContact: {
          id: 7001,
          firstName: "Janet",
          lastName: "Mills",
          customText3: "FIN-001",
          address: {
            address1: "1 Main St",
            city: "Houston",
            state: "TX",
            zip: "77001",
            countryName: "United States",
          },
        },
        jobOrder: {
          id: 9901,
          owner: { id: 8, firstName: "Olivia", lastName: "Stone" },
        },
        dateBegin: 1774828800000,
      },
      {
        id: 49087,
        customText8: "No",
        customText18: "PO-456",
        customText60: "SO UK",
        candidate: { id: 516239, firstName: "Ava", lastName: "Tan" },
        clientCorporation: {
          id: 10,
          name: "Northwind",
          customText2: "Pending",
          customText10: null,
          customText11: "Northwind Services",
        },
        billingClientContact: {
          id: 7002,
          firstName: "Mark",
          lastName: "Lewis",
          customText3: null,
          address: {
            address1: "2 River Rd",
            address2: "Floor 4",
            city: "Aberdeen",
            countryName: "United Kingdom",
          },
        },
        jobOrder: {
          id: 9902,
          owner: { id: 9, firstName: "James", lastName: "Ivy" },
        },
        dateBegin: 1774828800000,
      },
    ]);

    mockBullhornClient.getCandidate
      .mockResolvedValueOnce({
        id: 516238,
        firstName: "Sammy",
        lastName: "Thackeray",
        email: "sammy@example.com",
        dateAdded: 1712115260447,
        owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
      })
      .mockResolvedValueOnce({
        id: 516239,
        firstName: "Ava",
        lastName: "Tan",
        email: "ava@example.com",
        dateAdded: 1712115260555,
        owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
      });

    mockBullhornClient.getCorporateUser.mockResolvedValue({
      id: 2906869,
      firstName: "Jazzey",
      lastName: "Rooney",
      email: "houseaccounts@spencer-ogden.com",
    });

    const report = await run();

    expect(mockBullhornClient.queryPlacementsByDateBeginRange).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      startMs: expect.any(Number),
      endMs: expect.any(Number),
      count: 200,
    });
    expect(report.totals).toEqual({
      totalPlacements: 2,
      matchedPlacements: 2,
      recipients: 2,
      skippedMissingCandidateId: 0,
      skippedMissingOwnerId: 0,
      skippedMissingOwnerEmail: 0,
    });
    expect(report.recipients).toHaveLength(2);
    expect(report.recipients[0]).toEqual({
      address: {
        email: "houseaccounts@spencer-ogden.com",
      },
      substitution_data: {
        placement_id: "49086",
        jobOrderOwner_firstName: "Olivia",
        candidate_name: "Sammy Thackeray",
        client_company_name: "Bubbles Oil",
        date_begin: "30 March 2026",
        so_entity: "SO Italy",
        legal_entity_name: "Spencer Ogden Ltd",
        billingClientContact_country_name: "United States",
        tob_agreed: "Agreed",
        po_required: "Yes",
        po_number: "PO-123",
        finance_ref_number: "FIN-001",
        billingClientContact_name: "Janet Mills",
        billingClientContact_full_address: "1 Main St, Houston, TX, 77001, United States",
      },
    });
    expect(report.sparkPost.sent).toBe(false);
    expect(report.sparkPost.payload).toEqual({
      content: {
        template_id: "template-123",
      },
      recipients: report.recipients,
    });
    expect(mockSparkPostClient.sendTransmission).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });
});
