const {
  inferClientCorporationKeyAccountPatch,
  isListedClientCorporationName,
} = require("../src/clientCorporationKeyAccountUtils");

test("matches listed client corporation prefixes case-insensitively", () => {
  expect(isListedClientCorporationName("Siemens Energy APAC")).toBe(true);
  expect(isListedClientCorporationName("GE/ Renewables")).toBe(true);
  expect(isListedClientCorporationName("Viridi Energy")).toBe(false);
});

test("builds Key Account patch when name is listed, customText7 is empty, and 24 hours have passed", () => {
  expect(
    inferClientCorporationKeyAccountPatch(
      {
        name: "Siemens Energy APAC",
        customText7: null,
        dateAdded: "2026-03-17T15:00:00.000Z",
      },
      {
        delayHours: 24,
        now: new Date("2026-03-18T15:01:00.000Z").getTime(),
      },
    ),
  ).toEqual({ customText7: "Key Account" });
});

test("does not build Key Account patch when name is not listed or delay has not passed", () => {
  expect(
    inferClientCorporationKeyAccountPatch(
      {
        name: "Viridi Energy",
        customText7: null,
        dateAdded: "2026-03-17T15:00:00.000Z",
      },
      {
        delayHours: 24,
        now: new Date("2026-03-18T15:01:00.000Z").getTime(),
      },
    ),
  ).toBeNull();

  expect(
    inferClientCorporationKeyAccountPatch(
      {
        name: "Siemens Energy APAC",
        customText7: null,
        dateAdded: "2026-03-17T15:00:00.000Z",
      },
      {
        delayHours: 24,
        now: new Date("2026-03-18T14:59:00.000Z").getTime(),
      },
    ),
  ).toBeNull();
});
