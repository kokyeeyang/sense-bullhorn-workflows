const { parseBullhornDateAdded, parseIsoDateStart } = require("../src/index");

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
});
