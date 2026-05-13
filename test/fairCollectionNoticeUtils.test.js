const {
  buildTransmission,
  getMatchDetails,
  isTimedRuleDue,
} = require("../src/utils/fairCollectionNoticeUtils");

test("fair collection notice is due at 6am Pacific or when forced", () => {
  expect(isTimedRuleDue({ businessHour: 6 })).toBe(true);
  expect(isTimedRuleDue({ businessHour: 5 })).toBe(false);
  expect(isTimedRuleDue({ businessHour: 5, force: true })).toBe(true);
});

test("fair collection notice matches candidates added on or after 2018-05-24", () => {
  expect(
    getMatchDetails({
      email: "candidate@example.com",
      dateAdded: Date.UTC(2018, 4, 24),
    }).matched,
  ).toBe(true);

  expect(
    getMatchDetails({
      email: "candidate@example.com",
      dateAdded: Date.UTC(2018, 4, 23, 23, 59, 59),
    }).failedChecks,
  ).toContain("dateAddedMatches");
});

test("fair collection notice builds inline candidate email payload", () => {
  const payload = buildTransmission({
    candidate: {
      email: "candidate@example.com",
    },
  });

  expect(payload.content.from).toEqual({
    name: "Spencer Ogden",
    email: "onboarding@spencer-ogden.com",
  });
  expect(payload.content.subject).toBe("Fair Collection Notice From Spencer Ogden");
  expect(payload.content.text).toContain("The purpose of this notification");
  expect(payload.recipients).toEqual([{ address: { email: "candidate@example.com" } }]);
});
