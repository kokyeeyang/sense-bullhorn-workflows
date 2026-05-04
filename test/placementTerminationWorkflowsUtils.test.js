const {
  WORKFLOW_RULES,
  buildDateEndQueryDates,
  buildDelayedChangeDateKeys,
  buildInlineTransmission,
  getRuleMatchDetails,
  matchesChangeRule,
  matchesCommonRule,
} = require("../src/utils/placementTerminationWorkflowsUtils");
const { PLACEMENT_FIELDS } = require("../src/workflows/placementTerminationWorkflowsSync");

test("adjusts dateEnd rules around Friday and Monday weekends", () => {
  const alabama = WORKFLOW_RULES.find((rule) => rule.key === "alabama-termination-notice");
  const tennessee = WORKFLOW_RULES.find((rule) => rule.key === "tennessee-termination-notice");

  expect(buildDateEndQueryDates({ rule: alabama, businessDateKey: "2026-05-01" })).toEqual([
    "2026-05-01",
    "2026-05-02",
  ]);
  expect(buildDateEndQueryDates({ rule: alabama, businessDateKey: "2026-05-04" })).toEqual([
    "2026-05-03",
    "2026-05-04",
  ]);
  expect(buildDateEndQueryDates({ rule: tennessee, businessDateKey: "2026-05-01" })).toEqual([
    "2026-04-30",
    "2026-05-01",
  ]);
});

test("builds delayed status scan dates with weekend adjustment", () => {
  expect(
    buildDelayedChangeDateKeys({
      businessDateKey: "2026-05-04",
      delayDays: 1,
      weekendAdjust: true,
    }),
  ).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
});

test("matches state termination rules with lowercase-style comparisons", () => {
  const alabama = WORKFLOW_RULES.find((rule) => rule.key === "alabama-termination-notice");

  expect(
    matchesCommonRule(
      {
        status: "Completed",
        employmentType: "Contract",
        dateEnd: Date.UTC(2026, 4, 1),
        jobOrder: { address: { state: "ALABAMA", countryName: "United States" } },
        candidate: { email: "candidate@example.com" },
      },
      alabama,
    ),
  ).toBe(true);
});

test("matches termination reason workflows from configured reason list", () => {
  const newYork = WORKFLOW_RULES.find((rule) => rule.key === "new-york-termination");

  expect(
    matchesChangeRule({
      rule: newYork,
      change: { oldValue: "Other", newValue: "Completed project" },
      placement: {
        employmentType: "CONTRACT",
        jobOrder: { address: { state: "New York" } },
      },
    }),
  ).toBe(true);
});

test("explains why a placement does not match a termination rule", () => {
  const colorado = WORKFLOW_RULES.find((rule) => rule.key === "colorado-termination");

  expect(
    getRuleMatchDetails({
      rule: colorado,
      change: { oldValue: "Approved", newValue: "Terminated" },
      placement: {
        status: "Terminated",
        employmentType: "Perm",
        jobOrder: { address: { state: "Georgia", countryName: "Canada" } },
      },
    }),
  ).toMatchObject({
    matched: false,
    failedChecks: ["stateMatches", "countryMatches", "employmentTypeMatches"],
    actual: {
      state: "Georgia",
      country: "Canada",
      employmentType: "Perm",
      newValue: "Terminated",
    },
    expected: {
      states: ["colorado"],
      country: "united states",
      employmentType: "contract",
      newStatusIn: ["terminated", "completed"],
    },
  });
});

test("builds inline SparkPost payload with CC recipients and literal placeholders", () => {
  const colorado = WORKFLOW_RULES.find((rule) => rule.key === "colorado-termination");
  const payload = buildInlineTransmission({
    rule: colorado,
    placement: {
      id: 123,
      candidate: {
        firstName: "Ava",
        lastName: "Tan",
        owner: { firstName: "Jordan", email: "owner@example.com" },
      },
    },
  });

  expect(payload.content.text).toContain("{{candidate.firstname}} {{candidate.lastname}}");
  expect(payload.content.headers).toEqual({ CC: "usapayrollqueries@spencer-ogden.com" });
  expect(payload.recipients).toEqual([
    { address: { email: "owner@example.com" } },
    {
      address: {
        email: "usapayrollqueries@spencer-ogden.com",
        header_to: "owner@example.com",
      },
    },
  ]);
});

test("uses Bullhorn-safe address fields for placement state and country", () => {
  expect(PLACEMENT_FIELDS).not.toContain("workState");
  expect(PLACEMENT_FIELDS).not.toContain(",country,");
  expect(PLACEMENT_FIELDS).toContain("jobOrder(id,title,employmentType,address(state,countryName)");
  expect(PLACEMENT_FIELDS).toContain("candidate(id,firstName,lastName,email,address(countryName)");
});
