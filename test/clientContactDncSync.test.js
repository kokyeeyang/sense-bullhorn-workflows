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
  searchClientContacts: jest.fn(),
  getClientCorporationStatusChange: jest.fn(),
  getClientCorporationContacts: jest.fn(),
  updateClientContact: jest.fn(),
};

jest.mock("../src/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/config");
const { buildDelayedScanWindow, run } = require("../src/clientContactDncSync");

describe("clientContactDncSync", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    loadConfig.mockReturnValue({
      DRY_RUN: false,
      CLIENT_CONTACT_DNC_CUTOFF_DATE: "2024-01-01",
      CLIENT_CONTACT_DNC_DELAY_HOURS: 60,
      CLIENT_CONTACT_DNC_SCAN_WINDOW_HOURS: 24,
      CLIENT_CONTACT_DNC_EVENT_SUBSCRIPTION_ID: "sense-client-contact-dnc-sync",
      CLIENT_CONTACT_DNC_EVENT_MAX_EVENTS: 100,
      CLIENT_CONTACT_DNC_QUERY_COUNT: 500,
      TEST_CLIENT_CORPORATION_ID: undefined,
      TEST_CLIENT_CONTACT_ID: undefined,
      RETRY_MAX_ATTEMPTS: 4,
      RETRY_BASE_DELAY_MS: 500,
      UPDATE_DELAY_MS: 0,
    });

    mockBullhornClient.getAuthorizationCode.mockResolvedValue("auth-code");
    mockBullhornClient.getAccessToken.mockResolvedValue("access-token");
    mockBullhornClient.login.mockResolvedValue({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
    });
    mockBullhornClient.upsertEventSubscription.mockResolvedValue({});
  });

  test("updates contacts from the delayed scan and client corporation status events in one run", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({
      events: [
        {
          entityId: 701,
          transactionID: "tx-1",
          updatedProperties: ["status"],
        },
        {
          entityId: 702,
          transactionID: "tx-2",
          updatedProperties: ["status"],
        },
      ],
    });

    mockBullhornClient.searchClientContacts.mockResolvedValue([
      {
        id: 9001,
        name: "Jane Smith",
        dateAdded: "2026-04-01T00:00:00.000Z",
        status: "Active",
        massMailOptOut: false,
        clientCorporation: {
          id: 700,
          name: "Northwind",
          status: "do not contact",
        },
      },
      {
        id: 9002,
        name: ".. Placeholder",
        dateAdded: "2026-04-01T00:00:00.000Z",
        status: "Active",
        massMailOptOut: false,
        clientCorporation: {
          id: 700,
          name: "Northwind",
          status: "do not contact",
        },
      },
    ]);

    mockBullhornClient.getClientCorporationStatusChange
      .mockResolvedValueOnce({ oldValue: "do not contact", newValue: "active" })
      .mockResolvedValueOnce({ oldValue: "", newValue: "do not contact" });

    mockBullhornClient.getClientCorporationContacts
      .mockResolvedValueOnce([
        {
          id: 9003,
          name: "Mark Lewis",
          dateAdded: "2026-04-02T00:00:00.000Z",
          status: "do not contact",
          massMailOptOut: true,
          clientCorporation: { id: 701, name: "Acme", status: "Active" },
        },
        {
          id: 9005,
          name: "Already Active",
          dateAdded: "2026-04-02T00:00:00.000Z",
          status: "Active",
          massMailOptOut: false,
          clientCorporation: { id: 701, name: "Acme", status: "Active" },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 9004,
          name: "Ava Tan",
          dateAdded: "2026-04-02T00:00:00.000Z",
          status: "Prospect",
          massMailOptOut: false,
          clientCorporation: { id: 702, name: "Globex", status: "do not contact" },
        },
        {
          id: 9006,
          name: ".. Placeholder",
          dateAdded: "2026-04-02T00:00:00.000Z",
          status: "Prospect",
          massMailOptOut: false,
          clientCorporation: { id: 702, name: "Globex", status: "do not contact" },
        },
      ]);

    const result = await run();

    expect(mockBullhornClient.updateClientContact).toHaveBeenCalledTimes(3);
    expect(mockBullhornClient.updateClientContact).toHaveBeenNthCalledWith(1, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientContactId: 9001,
      patch: {
        massMailOptOut: true,
        status: "do not contact",
      },
    });
    expect(mockBullhornClient.updateClientContact).toHaveBeenNthCalledWith(2, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientContactId: 9003,
      patch: {
        massMailOptOut: false,
        status: "Active",
      },
    });
    expect(mockBullhornClient.updateClientContact).toHaveBeenNthCalledWith(3, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientContactId: 9004,
      patch: {
        massMailOptOut: true,
        status: "do not contact",
      },
    });
    expect(result.totals).toEqual({
      totalContactsScanned: 2,
      totalEvents: 2,
      matchedClientCorporationTransitions: 2,
      affectedContacts: 3,
      updated: 3,
      skippedDelayNotMet: 0,
      skippedBlockedName: 1,
      skippedClientNotDoNotContact: 0,
      skippedContactAlreadyDoNotContact: 0,
      skippedNoStatusEventChange: 0,
      skippedWrongTransition: 0,
      skippedDuplicateContact: 0,
      skippedNoChange: 0,
    });
    expect(result.affectedContacts[0]).toMatchObject({
      clientContactId: 9001,
      source: "new-contact-delay-scan",
      patchType: "set-do-not-contact",
    });
    expect(result.skippedContacts).toEqual([
      {
        clientContactId: 9002,
        source: "new-contact-delay-scan",
        reason: "blocked-contact-name-prefix",
        contact: {
          name: ".. Placeholder",
          firstName: null,
          lastName: null,
          dateAdded: "2026-04-01T00:00:00.000Z",
          status: "Active",
          massMailOptOut: false,
        },
        clientCorporation: {
          id: 700,
          name: "Northwind",
          status: "do not contact",
        },
      },
    ]);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  test("uses TEST_CLIENT_CORPORATION_ID to avoid the broad contact search", async () => {
    loadConfig.mockReturnValue({
      DRY_RUN: true,
      CLIENT_CONTACT_DNC_CUTOFF_DATE: "2024-01-01",
      CLIENT_CONTACT_DNC_DELAY_HOURS: 60,
      CLIENT_CONTACT_DNC_SCAN_WINDOW_HOURS: 24,
      CLIENT_CONTACT_DNC_EVENT_SUBSCRIPTION_ID: "sense-client-contact-dnc-sync",
      CLIENT_CONTACT_DNC_EVENT_MAX_EVENTS: 100,
      CLIENT_CONTACT_DNC_QUERY_COUNT: 500,
      TEST_CLIENT_CORPORATION_ID: 149888,
      TEST_CLIENT_CONTACT_ID: undefined,
      RETRY_MAX_ATTEMPTS: 4,
      RETRY_BASE_DELAY_MS: 500,
      UPDATE_DELAY_MS: 0,
    });

    mockBullhornClient.consumeEvents.mockResolvedValue({ events: [] });
    mockBullhornClient.getClientCorporationContacts.mockResolvedValue([]);

    const result = await run();

    expect(mockBullhornClient.searchClientContacts).not.toHaveBeenCalled();
    expect(mockBullhornClient.getClientCorporationContacts).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientCorporationId: 149888,
      count: 500,
    });
    expect(result.totals.totalContactsScanned).toBe(0);
  });

  test("broad delayed scan excludes contacts already in do not contact status at query time", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({ events: [] });
    mockBullhornClient.searchClientContacts.mockResolvedValue([]);

    await run();

    expect(mockBullhornClient.searchClientContacts).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      fromEpochSeconds: expect.any(Number),
      toEpochSeconds: expect.any(Number),
      clientContactId: null,
      excludeStatus: "do not contact",
    });
  });

  test("builds a rolling delayed-scan window around the grace-period threshold", () => {
    expect(
      buildDelayedScanWindow({
        fromEpoch: 1704067200,
        delayHours: 60,
        scanWindowHours: 24,
        now: new Date("2026-04-06T12:00:00.000Z").getTime(),
      }),
    ).toEqual({
      fromEpochSeconds: 1775174400,
      toEpochSeconds: 1775260800,
      delayHours: 60,
      scanWindowHours: 24,
    });
  });
});
