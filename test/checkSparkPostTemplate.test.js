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

const mockSparkPostClient = {
  getTemplate: jest.fn(),
};

jest.mock("../src/clients/sparkPostClient", () => ({
  SparkPostClient: jest.fn(() => mockSparkPostClient),
}));

const { loadConfig } = require("../src/helpers/config");
const { run } = require("../src/workflows/checkSparkPostTemplate");

describe("checkSparkPostTemplate", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      SPARKPOST_API_BASE_URL: "https://api.eu.sparkpost.com",
      SPARKPOST_API_KEY: "sparkpost-key",
      SPARKPOST_TEMPLATE_ID: "test-yy",
      RETRY_MAX_ATTEMPTS: 4,
      RETRY_BASE_DELAY_MS: 500,
    });
  });

  test("checks the configured template id", async () => {
    mockSparkPostClient.getTemplate.mockResolvedValue({
      results: {
        id: "test-yy",
        name: "Test",
        published: true,
      },
    });

    const result = await run();

    expect(mockSparkPostClient.getTemplate).toHaveBeenCalledWith("test-yy");
    expect(result).toEqual({
      results: {
        id: "test-yy",
        name: "Test",
        published: true,
      },
    });
  });
});
