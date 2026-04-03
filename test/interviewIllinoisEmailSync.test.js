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
  getAppointment: jest.fn(),
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
const { getTemplateId, run } = require("../src/interviewIllinoisEmailSync");

describe("interviewIllinoisEmailSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: true,
      INTERVIEW_ILLINOIS_EVENT_SUBSCRIPTION_ID: "sense-interview-illinois-email",
      INTERVIEW_ILLINOIS_EVENT_MAX_EVENTS: 100,
      INTERVIEW_ILLINOIS_JOB_ORDER_STATE: "Illinois",
      INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED: "2024-05-01",
      INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "contract",
      INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID: "interview-illinois-template",
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

  test("prefers the dedicated interview template id", () => {
    expect(
      getTemplateId({
        INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID: "interview-template",
        SPARKPOST_TEMPLATE_ID: "fallback-template",
      }),
    ).toBe("interview-template");
  });

  test("builds one SparkPost recipient per matching Illinois interview and does not send in dry run", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({
      events: [
        { entityId: 701 },
        { entityId: 702 },
        { entityId: 703 },
      ],
    });
    mockBullhornClient.getAppointment
      .mockResolvedValueOnce({
        id: 701,
        type: "Interview",
        dateAdded: 1714600000000,
        candidateReference: {
          id: 516238,
          firstName: "Sammy",
          lastName: "Thackeray",
          name: "Sammy Thackeray",
        },
        jobOrder: {
          id: 49086,
          dateAdded: "2024-05-01T08:30:00.000Z",
          employmentType: "contract",
          address: { state: "Illinois" },
          owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
        },
      })
      .mockResolvedValueOnce({
        id: 702,
        type: "Interview",
        candidateReference: {
          id: 516239,
          firstName: "Ava",
          lastName: "Tan",
        },
        jobOrder: {
          id: 49087,
          dateAdded: "2024-05-01T08:30:00.000Z",
          employmentType: "permanent",
          address: { state: "Illinois" },
          owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
        },
      })
      .mockResolvedValueOnce({
        id: 703,
        type: "Meeting",
        candidateReference: {
          id: 516240,
          firstName: "Kai",
          lastName: "Lee",
        },
        jobOrder: {
          id: 49088,
          dateAdded: "2024-05-01T08:30:00.000Z",
          employmentType: "contract",
          address: { state: "Illinois" },
          owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
        },
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
      subscriptionId: "sense-interview-illinois-email",
      entityName: "Appointment",
      eventType: "INSERTED",
    });
    expect(mockBullhornClient.consumeEvents).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      subscriptionId: "sense-interview-illinois-email",
      maxEvents: 100,
    });
    expect(report.totals).toEqual({
      totalEvents: 3,
      matchedAppointments: 1,
      recipients: 1,
      skippedNonInterview: 1,
      skippedMissingAppointmentId: 0,
      skippedJobOrderMismatch: 1,
      skippedMissingOwnerId: 0,
      skippedMissingOwnerEmail: 0,
      skippedDuplicateAppointment: 0,
    });
    expect(report.sparkPost.payload).toEqual({
      content: {
        template_id: "interview-illinois-template",
      },
      recipients: [
        {
          address: {
            email: "owner@example.com",
          },
          substitution_data: {
            id: "701",
            candidateReference: {
              name: "Sammy Thackeray",
              id: "516238",
            },
          },
        },
      ],
    });
    expect(mockSparkPostClient.sendTransmission).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });
});
