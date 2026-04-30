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
  upsertEventSubscription: jest.fn(),
  consumeEvents: jest.fn(),
  searchClientContacts: jest.fn(),
  getClientCorporationStatusChange: jest.fn(),
  getClientCorporationContacts: jest.fn(),
  updateClientContact: jest.fn(),
};

jest.mock("../src/clients/bullhornClient", () => ({
  BullhornClient: jest.fn(() => mockBullhornClient),
}));

const fs = require("node:fs/promises");
const { loadConfig } = require("../src/helpers/config");
const { buildDelayedScanWindow, run } = require("../src/workflows/clientContactDncSync");

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
        {
          entityId: 703,
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
      {
        id: 9009,
        name: "Pat Active Company",
        dateAdded: "2026-04-01T00:00:00.000Z",
        status: "Do Not Contact",
        massMailOptOut: true,
        clientCorporation: {
          id: 704,
          name: "Umbrella",
          status: "Active",
        },
      },
    ]);

    mockBullhornClient.getClientCorporationStatusChange
      .mockResolvedValueOnce({ oldValue: "Do Not Contact", newValue: "Active" })
      .mockResolvedValueOnce({ oldValue: "active", newValue: "do not contact" });

    mockBullhornClient.getClientCorporationContacts
      .mockResolvedValueOnce([
        {
          id: 9003,
          name: "Mark Lewis",
          dateAdded: "2026-04-02T00:00:00.000Z",
          status: "Do Not Contact",
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
      ])
      .mockResolvedValueOnce([
        {
          id: 9007,
          name: "Riley Cho",
          dateAdded: "2026-04-02T00:00:00.000Z",
          status: "Do Not Contact",
          massMailOptOut: true,
          clientCorporation: { id: 703, name: "Initech", status: "Active" },
        },
        {
          id: 9008,
          name: "Already Active Current State",
          dateAdded: "2026-04-02T00:00:00.000Z",
          status: "Active",
          massMailOptOut: false,
          clientCorporation: { id: 703, name: "Initech", status: "Active" },
        },
      ]);

    const result = await run();

    expect(mockBullhornClient.updateClientContact).toHaveBeenCalledTimes(5);
    expect(mockBullhornClient.updateClientContact).toHaveBeenNthCalledWith(1, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientContactId: 9001,
      patch: {
        massMailOptOut: true,
        status: "Do Not Contact",
      },
    });
    expect(mockBullhornClient.updateClientContact).toHaveBeenNthCalledWith(2, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientContactId: 9009,
      patch: {
        massMailOptOut: false,
        status: "Active",
      },
    });
    expect(mockBullhornClient.updateClientContact).toHaveBeenNthCalledWith(3, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientContactId: 9003,
      patch: {
        massMailOptOut: false,
        status: "Active",
      },
    });
    expect(mockBullhornClient.updateClientContact).toHaveBeenNthCalledWith(4, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientContactId: 9004,
      patch: {
        massMailOptOut: true,
        status: "Do Not Contact",
      },
    });
    expect(mockBullhornClient.updateClientContact).toHaveBeenNthCalledWith(5, {
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      clientContactId: 9007,
      patch: {
        massMailOptOut: false,
        status: "Active",
      },
    });
    expect(result.totals).toEqual({
      totalContactsScanned: 3,
      totalEvents: 3,
      matchedClientCorporationTransitions: 3,
      affectedContacts: 5,
      updated: 5,
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
    expect(result.affectedContacts[1]).toMatchObject({
      clientContactId: 9009,
      source: "new-contact-delay-scan",
      patchType: "set-active",
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

  test("broad delayed scan includes do not contact contacts for active-company reactivation", async () => {
    mockBullhornClient.consumeEvents.mockResolvedValue({ events: [] });
    mockBullhornClient.searchClientContacts.mockResolvedValue([]);

    await run();

    expect(mockBullhornClient.searchClientContacts).toHaveBeenCalledWith({
      restUrl: "https://rest.example.com",
      bhRestToken: "token",
      fromEpochSeconds: expect.any(Number),
      toEpochSeconds: expect.any(Number),
      clientContactId: null,
      excludeStatus: null,
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
