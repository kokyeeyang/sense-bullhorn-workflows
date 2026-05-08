const {
  RULES,
  WORKFLOW_NAME,
  buildDateBeginQueryDates,
  buildInlineTransmission,
  buildRuleExecutionPlan,
  getMatchDetails,
} = require("../src/utils/americasInternalPlacementNoticesUtils");

describe("americasInternalPlacementNoticesUtils", () => {
  test("maps saturday perm check-in send to friday run", () => {
    const rule = RULES.find((item) => item.key === "americas-perm-checkin-missing");

    expect(buildDateBeginQueryDates({ rule, businessDateKey: "2026-05-08" })).toContain("2026-05-06");
  });

  test("perm confirm scheduled start queries exact offset when weekends send anyway", () => {
    const rule = RULES.find((item) => item.key === "americas-perm-confirm-scheduled-start");

    expect(buildDateBeginQueryDates({ rule, businessDateKey: "2026-05-07" })).toEqual(["2026-05-11"]);
  });

  test("matches submitted review notice only for pre-hire to submitted change", () => {
    const rule = RULES.find((item) => item.key === "americas-deal-being-reviewed");
    const details = getMatchDetails(
      {
        id: 1,
        status: "Submitted",
        employmentType: "Contract",
        jobOrder: { address: { countryName: "United States" } },
      },
      rule,
      {
        change: {
          oldValue: "Pre-Hire",
          newValue: "Submitted",
        },
      },
    );

    expect(details.matched).toBe(true);
  });

  test("builds inline checklist email with embedded images and owner recipient", () => {
    const rule = RULES.find((item) => item.key === "americas-placement-checklist-contract");
    const transmission = buildInlineTransmission({
      rule,
      placement: {
        id: 5001,
        status: "Pre-Hire",
        employmentType: "Contract",
        owner: { id: 91, firstName: "Alex", email: "alex@example.com" },
        candidate: {
          id: 7001,
          firstName: "Ava",
          lastName: "Tan",
          owner: { firstName: "Morgan", email: "morgan@example.com" },
        },
      },
    });

    expect(transmission.recipients[0].address.email).toBe("alex@example.com");
    expect(transmission.content.inline_images).toHaveLength(2);
    expect(transmission.content.subject).toBe("Placement Checklist for QC");
    expect(transmission.content.html).toContain("cid:");
  });

  test("builds execution plan with hourly gate for timed rule", () => {
    const rule = RULES.find((item) => item.key === "americas-perm-checkin-missing");
    const plan = buildRuleExecutionPlan({
      rule,
      businessDateKey: "2026-05-08",
      businessHour: 10,
    });

    expect(plan.ruleKey).toBe("americas-perm-checkin-missing");
    expect(plan.timedRuleDue).toBe(true);
  });

  test("workflow name remains stable", () => {
    expect(WORKFLOW_NAME).toBe("americas-internal-placement-notices-sync");
  });
});
