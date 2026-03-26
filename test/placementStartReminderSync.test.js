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

jest.mock("../src/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/config");
const { buildUtcDayWindow, run } = require("../src/placementStartReminderSync");

describe("placementStartReminderSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: true,
      PLACEMENT_START_REMINDER_DAYS_AHEAD: 4,
      PLACEMENT_START_REMINDER_QUERY_COUNT: 200,
      PLACEMENT_START_REMINDER_WINDOW_BEFORE_DAYS: 0,
      PLACEMENT_START_REMINDER_WINDOW_AFTER_DAYS: 0,
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

  test("groups placements by owner email", async () => {
    mockBullhornClient.queryPlacementsByDateBeginRange.mockResolvedValue([
      {
        id: 49086,
        candidate: { id: 516238, firstName: "Sammy", lastName: "Thackeray" },
        clientCorporation: { id: 9, name: "Bubbles Oil" },
        dateBegin: 1774828800000,
      },
      {
        id: 49087,
        candidate: { id: 516239, firstName: "Ava", lastName: "Tan" },
        clientCorporation: { id: 10, name: "Northwind" },
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

    mockBullhornClient.getCorporateUser
      .mockResolvedValueOnce({
        id: 2906869,
        firstName: "Jazzey",
        lastName: "Rooney",
        email: "houseaccounts@spencer-ogden.com",
      })
      .mockResolvedValueOnce({
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
      recipients: 1,
      skippedMissingCandidateId: 0,
      skippedMissingOwnerId: 0,
      skippedMissingOwnerEmail: 0,
    });
    expect(report.recipients).toHaveLength(1);
    expect(report.recipients[0].owner.email).toBe("houseaccounts@spencer-ogden.com");
    expect(report.recipients[0].placementCount).toBe(2);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });
});
