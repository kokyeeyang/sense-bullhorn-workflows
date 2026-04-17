const { parseIsoDateStart } = require("../src/index");

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
});
