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
const { run } = require("../src/placementBenefitsReminderSync");

describe("placementBenefitsReminderSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: true,
      PLACEMENT_BENEFITS_REMINDER_QUERY_COUNT: 200,
      PLACEMENT_BENEFITS_REMINDER_DAY10_SPARKPOST_TEMPLATE_ID: "benefits-day-10",
      PLACEMENT_BENEFITS_REMINDER_DAY21_SPARKPOST_TEMPLATE_ID: "benefits-day-21",
      PLACEMENT_BENEFITS_REMINDER_DAY26_SPARKPOST_TEMPLATE_ID: "benefits-day-26",
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

  test("builds stage-based reminders and does not send in dry run", async () => {
    mockBullhornClient.queryPlacementsByDateBeginRange
      .mockResolvedValueOnce([
        {
          id: 5001,
          status: "approved",
          employmentType: "Contract",
          dateBegin: 1774828800000,
          candidate: { id: 7001 },
          clientCorporation: { id: 999, name: "Acme Power" },
          jobOrder: { id: 801, title: "Engineer", owner: { id: 9001 } },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 5002,
          status: "qc approved",
          employmentType: "Contract",
          dateBegin: 1773878400000,
          candidate: { id: 7002 },
          clientCorporation: { id: 998, name: "Beta Renewables" },
          jobOrder: { id: 802, title: "Analyst", owner: { id: 9002 } },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 5003,
          status: "approved",
          employmentType: "Permanent",
          dateBegin: 1773446400000,
          candidate: { id: 7003 },
          clientCorporation: { id: 997, name: "Skip Corp" },
          jobOrder: { id: 803, title: "Manager", owner: { id: 9003 } },
        },
      ]);

    mockBullhornClient.getCandidate
      .mockResolvedValueOnce({
        id: 7001,
        firstName: "Ava",
        lastName: "Tan",
        email: "ava@example.com",
        benefitPackage: "benefit eligible",
        owner: { id: 9101 },
      })
      .mockResolvedValueOnce({
        id: 7002,
        firstName: "Ben",
        lastName: "Lee",
        email: "ben@example.com",
        benefitPackage: "benefit eligible",
        owner: { id: 9102 },
      })
      .mockResolvedValueOnce({
        id: 7003,
        firstName: "Chris",
        lastName: "Fox",
        email: "chris@example.com",
        benefitPackage: "benefit eligible",
        owner: { id: 9103 },
      });

    mockBullhornClient.getCorporateUser.mockImplementation(async ({ corporateUserId }) => {
      const users = {
        9001: { id: 9001, firstName: "June", lastName: "Stone", email: "job10@example.com" },
        9002: { id: 9002, firstName: "Ivy", lastName: "Shaw", email: "job21@example.com" },
        9003: { id: 9003, firstName: "No", lastName: "Use", email: "job26@example.com" },
        9101: {
          id: 9101,
          firstName: "Cora",
          lastName: "Miles",
          email: "candidate.owner10@example.com",
          primaryDepartment: { name: "hou - perms" },
        },
        9102: {
          id: 9102,
          firstName: "Drew",
          lastName: "Lane",
          email: "candidate.owner21@example.com",
          primaryDepartment: { name: "hou - perms" },
        },
        9103: {
          id: 9103,
          firstName: "Eli",
          lastName: "Cole",
          email: "candidate.owner26@example.com",
          primaryDepartment: { name: "hou - perms" },
        },
      };

      return users[corporateUserId];
    });

    const result = await run({ targetDate: "2026-04-15" });

    expect(mockBullhornClient.queryPlacementsByDateBeginRange).toHaveBeenCalledTimes(3);
    expect(result.totals).toEqual({
      totalPlacementsQueried: 3,
      matchedPlacements: 2,
      day10Count: 1,
      day21Count: 1,
      day26Count: 0,
      skippedNonMatchingPlacement: 1,
      skippedMissingCandidateEmail: 0,
      missingCandidateOwnerEmail: 0,
      missingJobOrderOwnerEmail: 0,
    });
    expect(result.placements).toHaveLength(2);
    expect(result.placements[0].stage.label).toBe("day-10");
    expect(result.placements[0].recipient).toEqual({
      toEmail: "ava@example.com",
      ccEmails: [],
      missingCandidateOwnerEmail: false,
      missingJobOrderOwnerEmail: false,
    });
    expect(result.placements[1].stage.label).toBe("day-21");
    expect(result.placements[1].recipient).toEqual({
      toEmail: "ben@example.com",
      ccEmails: ["job21@example.com", "candidate.owner21@example.com"],
      missingCandidateOwnerEmail: false,
      missingJobOrderOwnerEmail: false,
    });
    expect(result.sparkPost.sent).toBe(false);
    expect(mockSparkPostClient.sendTransmission).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });
});
