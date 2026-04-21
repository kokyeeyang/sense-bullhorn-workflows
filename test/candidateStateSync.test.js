const {
  buildCandidateDateWindow,
  buildManualDateLastModifiedWindow,
  parseBullhornDateAdded,
  parseBooleanFlag,
  parseIsoDateEnd,
  parseIsoDateStart,
} = require("../src/index");

describe("candidate state sync", () => {
  test("parses the cutoff date at the start of the UTC day", () => {
    expect(parseIsoDateStart("2022-01-01").toISOString()).toBe(
      "2022-01-01T00:00:00.000Z",
    );
  });

  test("rejects invalid cutoff dates", () => {
    expect(() => parseIsoDateStart("not-a-date")).toThrow(
      "Invalid CANDIDATE_STATE_SYNC_CUTOFF_DATE",
    );
  });

  test("parses dateTo at the end of the UTC day", () => {
    expect(parseIsoDateEnd("2026-04-21").toISOString()).toBe(
      "2026-04-21T23:59:59.999Z",
    );
  });

  test("uses rolling lookback with cutoff for scheduled runs", () => {
    const window = buildCandidateDateWindow({
      now: new Date("2026-04-21T09:00:00.000Z"),
      lookbackHours: 60,
      cutoffDateValue: "2018-10-31",
    });

    expect(window.from.toISOString()).toBe("2026-04-18T21:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-04-21T09:00:00.000Z");
  });

  test("parses Bullhorn dateAdded epoch seconds as milliseconds", () => {
    expect(new Date(parseBullhornDateAdded(1776764490)).toISOString()).toBe(
      "2026-04-21T09:41:30.000Z",
    );
  });

  test("parses Bullhorn dateAdded epoch milliseconds without changing it", () => {
    expect(parseBullhornDateAdded(1776764490000)).toBe(1776764490000);
  });

  test("parses Bullhorn dateAdded ISO strings", () => {
    expect(parseBullhornDateAdded("2026-04-21T09:41:30.000Z")).toBe(
      1776764490000,
    );
  });

  test("parses Bullhorn dateAdded Date objects", () => {
    expect(parseBullhornDateAdded(new Date("2026-04-21T09:41:30.000Z"))).toBe(
      1776764490000,
    );
  });

  test("parses manual mode boolean flags", () => {
    expect(parseBooleanFlag(true)).toBe(true);
    expect(parseBooleanFlag("true")).toBe(true);
    expect(parseBooleanFlag("1")).toBe(true);
    expect(parseBooleanFlag("yes")).toBe(true);
    expect(parseBooleanFlag("false")).toBe(false);
    expect(parseBooleanFlag(null)).toBe(false);
  });

  test("builds manual dateLastModified window", () => {
    const window = buildManualDateLastModifiedWindow({
      dateFrom: "2026-04-12",
      dateTo: "2026-04-15",
    });

    expect(window.from.toISOString()).toBe("2026-04-12T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-04-15T23:59:59.999Z");
  });

  test("manual dateLastModified window requires both dates", () => {
    expect(() =>
      buildManualDateLastModifiedWindow({
        dateFrom: "2026-04-12",
      }),
    ).toThrow("requires both dateFrom and dateTo");
  });
});
