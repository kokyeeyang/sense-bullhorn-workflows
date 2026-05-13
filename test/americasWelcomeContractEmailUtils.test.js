const {
  buildImmediateChangeDateKeys,
  buildTransmission,
  firstNameHasExcludedFragment,
  getMatchDetails,
} = require("../src/utils/americasWelcomeContractEmailUtils");

test("welcome contract workflow catches weekend candidate note changes on Monday", () => {
  expect(buildImmediateChangeDateKeys({ businessDateKey: "2026-05-11" })).toEqual([
    "2026-05-09",
    "2026-05-10",
    "2026-05-11",
  ]);
  expect(buildImmediateChangeDateKeys({ businessDateKey: "2026-05-09" })).toEqual([]);
});

test("welcome contract workflow excludes configured first-name fragments", () => {
  expect(firstNameHasExcludedFragment("** do not contact**")).toBe(true);
  expect(firstNameHasExcludedFragment("Ava")).toBe(false);
});

test("welcome contract workflow matches US candidates after 2019 with talent platform change", () => {
  const match = getMatchDetails(
    {
      firstName: "Ava",
      email: "ava@example.com",
      dateAdded: Date.UTC(2019, 0, 2),
      address: { countryName: "United States" },
    },
    {
      change: {
        oldValue: "Other",
        newValue: "Talent platform initiated",
      },
    },
  );

  expect(match.matched).toBe(true);
});

test("welcome contract workflow can match current candidate action-type field", () => {
  const match = getMatchDetails(
    {
      firstName: "Ava",
      email: "ava@example.com",
      dateAdded: Date.UTC(2019, 0, 2),
      address: { countryName: "United States" },
      customText12: "Talent platform initiated",
    },
    {
      actionTypeField: "customText12",
    },
  );

  expect(match.matched).toBe(true);
  expect(match.actual.actionTypeField).toBe("customText12");
});

test("welcome contract workflow builds onboarding payload with attachment-ready content", () => {
  const payload = buildTransmission({
    candidate: {
      firstName: "Ava",
      email: "ava@example.com",
    },
  });

  expect(payload.content.from).toEqual({
    name: "Spencer Ogden CCS",
    email: "onboarding@spencer-ogden.com",
  });
  expect(payload.content.subject).toBe("Important- Spencer Ogden Onboarding");
  expect(payload.content.text).toContain("Hello Ava,");
  expect(payload.recipients).toEqual([{ address: { email: "ava@example.com" } }]);
});
