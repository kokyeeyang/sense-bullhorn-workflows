jest.mock("axios", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

jest.mock("../src/stores/postgresWorkflowEmailTransmissionStore", () => ({
  insertWorkflowEmailTransmissionPostgres: jest.fn().mockResolvedValue({ skipped: true }),
}));

const axios = require("axios");
const { SparkPostClient } = require("../src/clients/sparkPostClient");

function buildClient(config = {}) {
  return new SparkPostClient({
    config: {
      SPARKPOST_API_BASE_URL: "https://api.sparkpost.com",
      SPARKPOST_API_KEY: "sparkpost-key",
      RETRY_MAX_ATTEMPTS: 1,
      RETRY_BASE_DELAY_MS: 1,
      ...config,
    },
    logger: {
      warn: jest.fn(),
    },
  });
}

describe("SparkPostClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { results: { id: "tx-1" } } });
  });

  test("adds Bullhorn tracking recipient to template transmissions when configured", async () => {
    const client = buildClient({
      BULLHORN_EMAIL_TRACKING_BCC: "spencerogden.2386@sl40tracker.bullhornstaffing.com",
    });

    await client.sendTransmission({
      templateId: "template-1",
      recipients: [{ address: { email: "candidate@example.com" } }],
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.recipients).toEqual([
      { address: { email: "candidate@example.com" } },
      {
        address: {
          email: "spencerogden.2386@sl40tracker.bullhornstaffing.com",
          header_to: "candidate@example.com",
        },
      },
    ]);
    expect(payload.content.headers).toBeUndefined();
  });

  test("adds Bullhorn tracking recipient to inline transmissions when configured", async () => {
    const client = buildClient({
      BULLHORN_EMAIL_TRACKING_BCC: "spencerogden.2386@sl40tracker.bullhornstaffing.com",
    });

    await client.sendInlineTransmission({
      content: {
        from: { email: "sender@example.com" },
        subject: "Hello",
        text: "Hello",
      },
      recipients: [{ address: { email: "client@example.com" } }],
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.recipients[1]).toEqual({
      address: {
        email: "spencerogden.2386@sl40tracker.bullhornstaffing.com",
        header_to: "client@example.com",
      },
    });
  });

  test("does not add Bullhorn tracking recipient when config is blank", async () => {
    const client = buildClient();

    await client.sendTransmission({
      templateId: "template-1",
      recipients: [{ address: { email: "candidate@example.com" } }],
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.recipients).toEqual([{ address: { email: "candidate@example.com" } }]);
  });

  test("does not duplicate Bullhorn tracking recipient", async () => {
    const trackingEmail = "spencerogden.2386@sl40tracker.bullhornstaffing.com";
    const client = buildClient({
      BULLHORN_EMAIL_TRACKING_BCC: trackingEmail,
    });

    await client.sendTransmission({
      templateId: "template-1",
      recipients: [
        { address: { email: "candidate@example.com" } },
        { address: { email: trackingEmail, header_to: "candidate@example.com" } },
      ],
    });

    const payload = axios.post.mock.calls[0][1];
    expect(payload.recipients).toHaveLength(2);
  });
});
