const {
  buildContactName,
  getContactChanges,
  hasContactDelayPassed,
  inferCurrentClientCorporationContactPatch,
  inferEventDrivenContactPatch,
  inferNewContactDoNotContactPatch,
  isBlockedContactName,
  isClientCorporationStatusDoNotContactActivation,
  isClientCorporationStatusReactivation,
} = require("../src/utils/clientContactDncSyncUtils");

test("waits until 60 hours have passed since contact dateAdded", () => {
  expect(
    hasContactDelayPassed(
      { dateAdded: "2026-04-01T00:00:00.000Z" },
      60,
      new Date("2026-04-03T11:59:59.000Z").getTime(),
    ),
  ).toBe(false);

  expect(
    hasContactDelayPassed(
      { dateAdded: "2026-04-01T00:00:00.000Z" },
      60,
      new Date("2026-04-03T12:00:00.000Z").getTime(),
    ),
  ).toBe(true);
});

test("detects blocked contact names", () => {
  expect(isBlockedContactName({ name: ".. placeholder" })).toBe(true);
  expect(isBlockedContactName({ firstName: "****", lastName: "Skip" })).toBe(true);
  expect(isBlockedContactName({ firstName: "Jane", lastName: "Smith" })).toBe(false);
});

test("matches client corporation status transitions", () => {
  expect(
    isClientCorporationStatusReactivation({
      oldValue: "Do Not Contact",
      newValue: "Active",
    }),
  ).toBe(true);
  expect(
    isClientCorporationStatusDoNotContactActivation({
      oldValue: null,
      newValue: "do not contact",
    }),
  ).toBe(true);
  expect(
    isClientCorporationStatusDoNotContactActivation({
      oldValue: "Active",
      newValue: "do not contact",
    }),
  ).toBe(true);
  expect(
    isClientCorporationStatusDoNotContactActivation({
      oldValue: "do not contact",
      newValue: "do not contact",
    }),
  ).toBe(false);
});

test("builds delay-based DNC patch only when all conditions match", () => {
  expect(
    inferNewContactDoNotContactPatch(
      {
        name: "Jane Smith",
        dateAdded: "2026-04-01T00:00:00.000Z",
        status: "Active",
        clientCorporation: { status: "do not contact" },
      },
      { delayHours: 60, now: new Date("2026-04-03T12:00:00.000Z").getTime() },
    ),
  ).toEqual({
    massMailOptOut: true,
    status: "Do Not Contact",
  });

  expect(
    inferNewContactDoNotContactPatch(
      {
        name: ".. Placeholder",
        dateAdded: "2026-04-01T00:00:00.000Z",
        status: "Active",
        clientCorporation: { status: "do not contact" },
      },
      { delayHours: 60, now: new Date("2026-04-03T12:00:00.000Z").getTime() },
    ),
  ).toBeNull();
});

test("builds event-driven patches", () => {
  expect(
    inferEventDrivenContactPatch({
      statusChange: { oldValue: "Do Not Contact", newValue: "Active" },
      contact: { status: "Do Not Contact", name: "Jane Smith" },
    }),
  ).toEqual({
    massMailOptOut: false,
    status: "Active",
  });

  expect(
    inferEventDrivenContactPatch({
      statusChange: { oldValue: "Active", newValue: "do not contact" },
      contact: { status: "Prospect", name: "Jane Smith" },
    }),
  ).toEqual({
    massMailOptOut: true,
    status: "Do Not Contact",
  });

  expect(
    inferEventDrivenContactPatch({
      statusChange: { oldValue: "Do Not Contact", newValue: "Active" },
      contact: { status: "Active", name: "Jane Smith" },
    }),
  ).toBeNull();

  expect(
    inferEventDrivenContactPatch({
      statusChange: { oldValue: "Prospect", newValue: "do not contact" },
      contact: { status: "Active", name: ".. Placeholder" },
    }),
  ).toBeNull();
});

test("builds current client corporation status reconciliation patches", () => {
  expect(
    inferCurrentClientCorporationContactPatch({
      status: "Do Not Contact",
      name: "Jane Smith",
      clientCorporation: { status: "Active" },
    }),
  ).toEqual({
    massMailOptOut: false,
    status: "Active",
  });

  expect(
    inferCurrentClientCorporationContactPatch({
      status: "Active",
      name: "Jane Smith",
      clientCorporation: { status: "Do Not Contact" },
    }),
  ).toEqual({
    massMailOptOut: true,
    status: "Do Not Contact",
  });

  expect(
    inferCurrentClientCorporationContactPatch({
      status: "Do Not Contact",
      name: ".. Placeholder",
      clientCorporation: { status: "Active" },
    }),
  ).toBeNull();
});

test("computes contact field changes and normalizes opt-out values", () => {
  expect(
    getContactChanges(
      {
        status: "Active",
        massMailOptOut: "No",
      },
      {
        status: "Do Not Contact",
        massMailOptOut: true,
      },
    ),
  ).toEqual([
    { field: "status", oldValue: "Active", newValue: "Do Not Contact" },
    { field: "massMailOptOut", oldValue: false, newValue: true },
  ]);
});

test("builds a fallback full name when explicit name is missing", () => {
  expect(buildContactName({ firstName: "Jane", lastName: "Smith" })).toBe("Jane Smith");
});
