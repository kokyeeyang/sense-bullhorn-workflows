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
  queryJobOrdersByDateAddedRange: jest.fn(),
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
const { getTemplateId, run } = require("../src/newJobIllinoisEmailSync");

describe("newJobIllinoisEmailSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: true,
      NEW_JOB_ILLINOIS_GRACE_HOURS: 24,
      NEW_JOB_ILLINOIS_QUERY_COUNT: 200,
      NEW_JOB_ILLINOIS_JOB_ORDER_STATE: "Illinois",
      NEW_JOB_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "contract",
      NEW_JOB_ILLINOIS_SPARKPOST_TEMPLATE_ID: "new-job-illinois-template",
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
  });

  test("prefers the dedicated new job Illinois template id", () => {
    expect(
      getTemplateId({
        NEW_JOB_ILLINOIS_SPARKPOST_TEMPLATE_ID: "job-template",
        SPARKPOST_TEMPLATE_ID: "fallback-template",
      }),
    ).toBe("job-template");
  });

  test("builds one SparkPost recipient per matching job order and does not send in dry run", async () => {
    mockBullhornClient.queryJobOrdersByDateAddedRange.mockResolvedValue([
      {
        id: 49086,
        dateAdded: 1776246000000,
        employmentType: "contract",
        address: { state: "Illinois" },
        clientCorporation: { id: 109, name: "Acme Corp" },
        owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
      },
      {
        id: 49087,
        dateAdded: 1776246000000,
        employmentType: "permanent",
        address: { state: "Illinois" },
        clientCorporation: { id: 110, name: "Beta Corp" },
        owner: { id: 2906869, firstName: "Jazzey", lastName: "Rooney" },
      },
    ]);
    mockBullhornClient.getCorporateUser.mockResolvedValue({
      id: 2906869,
      firstName: "Jazzey",
      lastName: "Rooney",
      email: "owner@example.com",
    });

    const result = await run();

    expect(mockBullhornClient.queryJobOrdersByDateAddedRange).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      startMs: expect.any(Number),
      endMs: expect.any(Number),
      count: 200,
    });
    expect(result.totals).toEqual({
      totalJobOrders: 2,
      matchedJobOrders: 1,
      recipients: 1,
      skippedJobOrderMismatch: 1,
      skippedMissingOwnerId: 0,
      skippedMissingOwnerEmail: 0,
    });
    expect(result.sparkPost.payload).toEqual({
      content: {
        template_id: "new-job-illinois-template",
      },
      recipients: [
        {
          address: {
            email: "owner@example.com",
          },
          substitution_data: {
            id: "49086",
            job_order_id: "49086",
            client_corporation_name: "Acme Corp",
            job_order_date_added: 1776246000000,
            job_order_employment_type: "contract",
            job_order_state: "Illinois",
            owner_id: "2906869",
            owner_first_name: "Jazzey",
            owner_last_name: "Rooney",
            owner_email: "owner@example.com",
          },
        },
      ],
    });
    expect(mockSparkPostClient.sendTransmission).not.toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });
});
