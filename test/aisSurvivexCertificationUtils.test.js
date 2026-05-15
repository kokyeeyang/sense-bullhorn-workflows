const {
  addDays,
  buildTransmission,
  getMatchDetails,
  isTimedRuleDue,
} = require("../src/utils/aisSurvivexCertificationUtils");

test("AIS Survivex certification workflow targets expirations 90 days ahead", () => {
  expect(addDays("2026-05-13", 90)).toBe("2026-08-11");
  expect(isTimedRuleDue({ businessHour: 2 })).toBe(true);
  expect(isTimedRuleDue({ businessHour: 1 })).toBe(false);
  expect(isTimedRuleDue({ businessHour: 1, force: true })).toBe(true);
});

test("AIS Survivex certification matches Joe McCormick candidates placed within the last 90 days", () => {
  expect(
    getMatchDetails(
      {
        candidate: {
          email: "candidate@example.com",
          dateLastPlacementStarted: Date.UTC(2026, 4, 1),
          owner: { firstName: "Joe", lastName: "McCormick" },
        },
      },
      { businessDateKey: "2026-05-13" },
    ).matched,
  ).toBe(true);

  expect(
    getMatchDetails(
      {
        candidate: {
          email: "candidate@example.com",
          dateLastPlacementStarted: Date.UTC(2025, 11, 1),
          owner: { firstName: "Joe", lastName: "McCormick" },
        },
      },
      { businessDateKey: "2026-05-13" },
    ).failedChecks,
  ).toContain("lastPlacementStartedAfter90DaysAgo");
});

test("AIS Survivex certification builds candidate email payload", () => {
  const payload = buildTransmission({
    certification: {
      candidate: {
        firstName: "Ava",
        email: "ava@example.com",
      },
    },
  });

  expect(payload.content.from.email).toBe("noreply@spencer-ogden.com");
  expect(payload.content.subject).toBe("Your certificate is due for renewal");
  expect(payload.content.text).toContain("To Ava,");
  expect(payload.recipients).toEqual([{ address: { email: "ava@example.com" } }]);
});
