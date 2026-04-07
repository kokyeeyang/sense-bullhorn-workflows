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
  queryPlacementsByDateBeginRange: jest.fn(),
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
const { getTemplateId, run } = require("../src/placementYearlyFeeIncreaseSync");

describe("placementYearlyFeeIncreaseSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: true,
      PLACEMENT_YEARLY_FEE_INCREASE_MONTH_OFFSET: 11,
      PLACEMENT_YEARLY_FEE_INCREASE_QUERY_COUNT: 200,
      PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_BEFORE_DAYS: 0,
      PLACEMENT_YEARLY_FEE_INCREASE_WINDOW_AFTER_DAYS: 0,
      PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID: "placement-yearly-fee-increase",
      SPARKPOST_TEMPLATE_ID: "template-123",
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
  });

  test("prefers the yearly fee increase SparkPost template id", () => {
    expect(
      getTemplateId({
        PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID: "placement-yearly-fee-increase",
        SPARKPOST_TEMPLATE_ID: "fallback-template",
      }),
    ).toBe("placement-yearly-fee-increase");
  });

  test("builds one SparkPost recipient per matching placement and does not send in dry run", async () => {
    mockBullhornClient.queryPlacementsByDateBeginRange.mockResolvedValue([
      {
        id: 49086,
        employmentType: "Contract",
        dateBegin: 1743984000000,
        dateEnd: 1798761600000,
        candidate: { id: 516238, firstName: "Sammy", lastName: "Thackeray" },
        clientCorporation: {
          id: 9,
          name: "Bubbles Oil",
          customDate1: 1704067200000,
          billingFrequency: "5",
        },
        jobOrder: {
          id: 9901,
          title: "Offshore Lead Cables Engineer",
          owner: { id: 8, firstName: "Olivia", lastName: "Stone" },
        },
      },
      {
        id: 49087,
        employmentType: "Permanent",
        dateBegin: 1743984000000,
        dateEnd: 1798761600000,
        candidate: { id: 516239, firstName: "Ava", lastName: "Tan" },
        clientCorporation: {
          id: 10,
          name: "Northwind",
          customDate1: 1704067200000,
          billingFrequency: "5",
        },
        jobOrder: {
          id: 9902,
          title: "QA Analyst",
          owner: { id: 9, firstName: "James", lastName: "Ivy" },
        },
      },
    ]);

    mockBullhornClient.getCorporateUser.mockResolvedValue({
      id: 8,
      firstName: "Olivia",
      lastName: "Stone",
      email: "olivia@example.com",
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
      matchedPlacements: 1,
      recipients: 1,
      skippedNonMatchingPlacement: 1,
      skippedMissingOwnerId: 0,
      skippedMissingOwnerEmail: 0,
    });
    expect(report.recipients).toEqual([
      {
        address: {
          email: "olivia@example.com",
        },
        substitution_data: {
          owner_firstName: "Olivia Stone",
          client_company_name: "Bubbles Oil",
          yearly_fee_increase_percent: "5",
          placement_id: "49086",
          candidate_name: "Sammy Thackeray",
          placement_start_date: "7 April 2025",
          placement_end_date: "1 January 2027",
          job_title: "Offshore Lead Cables Engineer",
          tob_date: "1 January 2024",
        },
      },
    ]);
    expect(report.sparkPost.payload).toEqual({
      content: {
        template_id: "placement-yearly-fee-increase",
      },
      recipients: report.recipients,
    });
    expect(mockSparkPostClient.sendTransmission).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });
});
