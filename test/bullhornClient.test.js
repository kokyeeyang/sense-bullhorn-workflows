const axios = require("axios");
const { BullhornClient } = require("../src/clients/bullhornClient");

jest.mock("axios");

describe("BullhornClient", () => {
  const config = {
    RETRY_MAX_ATTEMPTS: 1,
    RETRY_BASE_DELAY_MS: 1,
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("searchCandidates uses fielded range syntax for candidate dateAdded searches", async () => {
    axios.get.mockResolvedValue({
      data: {
        data: [],
        total: 0,
      },
    });

    const client = new BullhornClient({ config, logger });
    await client.searchCandidates({
      restUrl: "https://example-rest.bullhornstaffing.com/rest-services/123",
      bhRestToken: "token",
      fromEpochSeconds: 1498867200,
      toEpochSeconds: 1509494399,
    });

    expect(axios.get).toHaveBeenCalledWith(
      "https://example-rest.bullhornstaffing.com/rest-services/123/search/Candidate",
      expect.objectContaining({
        params: expect.objectContaining({
          query: "dateAdded:[1498867200 TO 1509494399]",
        }),
      }),
    );
  });

  test("searchCandidates uses id query when candidateId is provided", async () => {
    axios.get.mockResolvedValue({
      data: {
        data: [],
        total: 0,
      },
    });

    const client = new BullhornClient({ config, logger });
    await client.searchCandidates({
      restUrl: "https://example-rest.bullhornstaffing.com/rest-services/123",
      bhRestToken: "token",
      fromEpochSeconds: 1498867200,
      toEpochSeconds: 1509494399,
      candidateId: 1776036,
    });

    expect(axios.get).toHaveBeenCalledWith(
      "https://example-rest.bullhornstaffing.com/rest-services/123/search/Candidate",
      expect.objectContaining({
        params: expect.objectContaining({
          query: "id:1776036",
        }),
      }),
    );
  });

  test("searchCandidatesByDateAddedRange fetches candidate email fields with dateAdded search", async () => {
    axios.get.mockResolvedValue({
      data: {
        data: [],
        total: 0,
      },
    });

    const client = new BullhornClient({ config, logger });
    await client.searchCandidatesByDateAddedRange({
      restUrl: "https://example-rest.bullhornstaffing.com/rest-services/123",
      bhRestToken: "token",
      startMs: 1498867200000,
      endMs: 1509494399000,
      fieldsOverride: "id,email,dateAdded",
    });

    expect(axios.get).toHaveBeenCalledWith(
      "https://example-rest.bullhornstaffing.com/rest-services/123/search/Candidate",
      expect.objectContaining({
        params: expect.objectContaining({
          query: "dateAdded:[1498867200 TO 1509494399]",
          fields: "id,email,dateAdded",
        }),
      }),
    );
  });

});
