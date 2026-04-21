const {
  getClientCorporationChanges,
  hasClientCorporationDelayPassed,
  inferClientCorporation360Patch,
  isEmptyCustomText7,
  isExcludedClientCorporationName,
} = require("../src/clientCorporation360Utils");

test("treats null and blank customText7 as empty", () => {
  expect(isEmptyCustomText7(null)).toBe(true);
  expect(isEmptyCustomText7("")).toBe(true);
  expect(isEmptyCustomText7("   ")).toBe(true);
  expect(isEmptyCustomText7("360")).toBe(false);
});

test("matches excluded client corporation prefixes case-insensitively", () => {
  expect(isExcludedClientCorporationName("Siemens Energy APAC")).toBe(true);
  expect(isExcludedClientCorporationName("GE/ Renewables")).toBe(true);
  expect(isExcludedClientCorporationName("Black and Veatch UK")).toBe(true);
  expect(isExcludedClientCorporationName("Viridi")).toBe(false);
});

test("builds 360 patch when customText7 is empty and name is not excluded", () => {
  expect(
    inferClientCorporation360Patch({
      name: "Viridi Energy",
      customText7: null,
      dateAdded: "2026-03-15T15:00:00.000Z",
    }, {
      delayHours: 24,
      now: new Date("2026-03-16T15:01:00.000Z").getTime(),
    }),
  ).toEqual({ customText7: "360" });
});

test("does not build patch when name is excluded or customText7 already exists", () => {
  expect(
    inferClientCorporation360Patch({
      name: "Siemens Energy",
      customText7: null,
      dateAdded: "2026-03-15T15:00:00.000Z",
    }, {
      delayHours: 24,
      now: new Date("2026-03-16T15:01:00.000Z").getTime(),
    }),
  ).toBeNull();

  expect(
    inferClientCorporation360Patch({
      name: "Viridi Energy",
      customText7: "key account",
      dateAdded: "2026-03-15T15:00:00.000Z",
    }, {
      delayHours: 24,
      now: new Date("2026-03-16T15:01:00.000Z").getTime(),
    }),
  ).toBeNull();
});

test("waits until 24 hours have passed since dateAdded", () => {
  const clientCorporation = {
    name: "Viridi Energy",
    customText7: null,
    dateAdded: "2026-03-17T15:00:00.000Z",
  };

  expect(
    hasClientCorporationDelayPassed(
      clientCorporation,
      24,
      new Date("2026-03-18T14:59:00.000Z").getTime(),
    ),
  ).toBe(false);

  expect(
    hasClientCorporationDelayPassed(
      clientCorporation,
      24,
      new Date("2026-03-18T15:01:00.000Z").getTime(),
    ),
  ).toBe(true);

  expect(
    inferClientCorporation360Patch(clientCorporation, {
      delayHours: 24,
      now: new Date("2026-03-18T14:59:00.000Z").getTime(),
    }),
  ).toBeNull();

  expect(
    inferClientCorporation360Patch(clientCorporation, {
      delayHours: 24,
      now: new Date("2026-03-18T15:01:00.000Z").getTime(),
    }),
  ).toEqual({ customText7: "360" });
});

test("computes client corporation field changes", () => {
  expect(
    getClientCorporationChanges(
      { customText7: null },
      { customText7: "360" },
    ),
  ).toEqual([
    { field: "customText7", oldValue: null, newValue: "360" },
  ]);
});
