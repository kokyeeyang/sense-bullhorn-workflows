const {
  RULES,
  WORKFLOW_NAME,
  buildRuleExecutionPlan,
  buildTransmission,
  getMatchDetails,
} = require("../src/utils/permCheckinUtils");

function buildPlacement(overrides = {}) {
  return {
    id: 12345,
    status: "QC Approved",
    dateBegin: Date.UTC(2026, 4, 11),
    employmentType: "Perm",
    owner: {
      id: 10,
      firstName: "Taylor",
      lastName: "Owner",
      email: "owner@example.com",
      primaryDepartment: { name: "SIN - Renewables" },
    },
    candidate: {
      id: 20,
      firstName: "Casey",
      lastName: "Starter",
      email: "candidate@example.com",
      owner: {
        id: 10,
        firstName: "Taylor",
        lastName: "Owner",
        email: "owner@example.com",
        primaryDepartment: { name: "SIN - Renewables" },
      },
    },
    clientContact: {
      id: 30,
      firstName: "Jordan",
      lastName: "Client",
      email: "client@example.com",
    },
    clientCorporation: {
      id: 40,
      name: "Acme Energy",
    },
    ...overrides,
  };
}

describe("permCheckinUtils", () => {
  test("matches APAC client placement using owner primary department", () => {
    const rule = RULES.find((item) => item.key === "apac-client");
    const details = getMatchDetails(buildPlacement(), rule);

    expect(details.matched).toBe(true);
    expect(details.actual.ownerDepartment).toBe("SIN - Renewables");
  });

  test("excludes Americas retain candidates", () => {
    const rule = RULES.find((item) => item.key === "americas-client");
    const placement = buildPlacement({
      owner: {
        id: 10,
        email: "owner@example.com",
        primaryDepartment: { name: "HOU - Perm O&G" },
      },
      candidate: {
        id: 20,
        firstName: "Retain",
        lastName: "Candidate",
        email: "candidate@example.com",
      },
    });

    const details = getMatchDetails(placement, rule);

    expect(details.matched).toBe(false);
    expect(details.failedChecks).toContain("candidateFirstNameAllowed");
  });

  test("requires contingent search type for EMEA", () => {
    const rule = RULES.find((item) => item.key === "emea-candidate");
    const placement = buildPlacement({
      searchType: "Retained",
      owner: {
        id: 10,
        email: "owner@example.com",
        primaryDepartment: { name: "LON - Perm Renewables" },
      },
    });

    const details = getMatchDetails(placement, rule);

    expect(details.matched).toBe(false);
    expect(details.failedChecks).toContain("searchTypeMatches");
  });

  test("builds client transmission with yes and no survey links", () => {
    const rule = RULES.find((item) => item.key === "apac-client");
    const transmission = buildTransmission({
      placement: buildPlacement(),
      rule,
      businessDateKey: "2026-05-11",
      config: {
        WORKFLOW_SURVEY_RESPONSE_BASE_URL: "https://example.com/respond",
        WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET: "secret",
      },
    });

    expect(transmission.recipients[0].address.email).toBe("client@example.com");
    expect(transmission.content.from.email).toBe("owner@example.com");
    expect(transmission.content.html).toContain("answer=yes");
    expect(transmission.content.html).toContain("answer=no");
    expect(transmission.tracking.workflowName).toBe(WORKFLOW_NAME);
  });

  test("hourly execution plan sends on exact Pacific hour", () => {
    const rule = RULES.find((item) => item.key === "americas-candidate");
    const plan = buildRuleExecutionPlan({
      rule,
      businessDateKey: "2026-05-11",
      businessHour: 9,
    });

    expect(plan.timedRuleDue).toBe(true);
    expect(plan.queryDateBeginDates).toEqual(["2026-05-11"]);
  });
});
