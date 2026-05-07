const {
  RULES,
  SURVEY_QUESTION_TEXT,
  buildDateBeginQueryDates,
  buildDelayedStatusChangeDateKeys,
  buildRuleExecutionPlan,
  buildTransmission,
  getMatchDetails,
} = require("../src/utils/americasOnboardingNoticesUtils");
const { verifyWorkflowSurveyToken } = require("../src/utils/workflowSurveyUtils");

describe("americasOnboardingNoticesUtils", () => {
  test("builds weekend-adjusted query dates for Friday and Monday paid leave rules", () => {
    const coloradoRule = RULES.find((rule) => rule.key === "colorado-healthy-families");

    expect(buildDateBeginQueryDates({ rule: coloradoRule, businessDateKey: "2026-05-08" })).toEqual([
      "2026-05-08",
      "2026-05-09",
    ]);

    expect(buildDateBeginQueryDates({ rule: coloradoRule, businessDateKey: "2026-05-11" })).toEqual([
      "2026-05-10",
      "2026-05-11",
    ]);
  });

  test("matches Colorado by minimum date, status, state, and employment type", () => {
    const coloradoRule = RULES.find((rule) => rule.key === "colorado-healthy-families");

    expect(
      getMatchDetails(
        {
          status: "Pre-Hire",
          dateBegin: Date.UTC(2021, 0, 1),
          employmentType: "Contract",
          jobOrder: {
            address: {
              state: "Colorado",
            },
          },
        },
        coloradoRule,
      ).matched,
    ).toBe(true);

    expect(
      getMatchDetails(
        {
          status: "Pre-Hire",
          dateBegin: Date.UTC(2020, 11, 31),
          employmentType: "Contract",
          jobOrder: {
            address: {
              state: "Colorado",
            },
          },
        },
        coloradoRule,
      ).matched,
    ).toBe(false);
  });

  test("can temporarily include extra statuses for onboarding notice testing", () => {
    const michiganRule = RULES.find((rule) => rule.key === "michigan-paid-medical-leave");

    expect(
      getMatchDetails(
        {
          status: "Submitted",
          employmentType: "Contract",
          jobOrder: {
            address: {
              state: "Michigan",
            },
          },
        },
        michiganRule,
      ).matched,
    ).toBe(false);

    expect(
      getMatchDetails(
        {
          status: "Submitted",
          employmentType: "Contract",
          jobOrder: {
            address: {
              state: "Michigan",
            },
          },
        },
        michiganRule,
        { extraStatuses: "submitted" },
      ).matched,
    ).toBe(true);
  });

  test("builds rule execution plan that explains outside-send-hour skips", () => {
    const nyRule = RULES.find((rule) => rule.key === "new-york-city-hero-act");

    expect(
      buildRuleExecutionPlan({
        rule: nyRule,
        businessDateKey: "2026-05-07",
        businessHour: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        ruleKey: "new-york-city-hero-act",
        timedRuleDue: false,
        expectedPacificHour: 9,
        businessHour: 1,
        skippedReason: "outside-send-hour",
        queryDateBeginDates: [],
      }),
    );
  });

  test("builds delayed status-change dates for NYC commuter rule", () => {
    const commuterRule = RULES.find((rule) => rule.key === "new-york-city-commuter");

    expect(
      buildDelayedStatusChangeDateKeys({
        businessDateKey: "2026-05-11",
        delayDays: commuterRule.delayDays,
        weekendAdjust: commuterRule.weekendAdjust,
      }),
    ).toEqual(["2026-05-08", "2026-05-09", "2026-05-10"]);
  });

  test("matches NYC commuter by new qc approved status change", () => {
    const commuterRule = RULES.find((rule) => rule.key === "new-york-city-commuter");

    expect(
      getMatchDetails(
        {
          employmentType: "Contract",
          jobOrder: {
            address: {
              state: "New York",
            },
          },
        },
        commuterRule,
        {
          change: {
            oldValue: "Submitted",
            newValue: "QC Approved",
          },
        },
      ).matched,
    ).toBe(true);
  });

  test("builds New York survey transmission with candidate owner sender and signed links", () => {
    const nyRule = RULES.find((rule) => rule.key === "new-york-city-hero-act");
    const transmission = buildTransmission({
      rule: nyRule,
      config: {
        WORKFLOW_SURVEY_RESPONSE_BASE_URL: "https://example.com/respond",
        WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET: "secret",
      },
      placement: {
        id: 123,
        status: "Submitted",
        candidate: {
          id: 456,
          firstName: "Ava",
          lastName: "Tan",
          email: "ava@example.com",
          owner: {
            id: 99,
            firstName: "Sam",
            lastName: "Owner",
            email: "sam.owner@example.com",
          },
        },
        clientCorporation: {
          name: "Client Co",
        },
      },
      attachments: [],
    });

    expect(transmission.content.from).toEqual({
      name: "Sam Owner",
      email: "sam.owner@example.com",
    });
    expect(transmission.content.subject).toBe("New York City - Hero Act");
    expect(transmission.content.html).toContain(SURVEY_QUESTION_TEXT);

    const yesUrl = new URL(
      transmission.content.html.match(/href="([^"]*answer=yes[^"]*)"/)[1],
    );
    expect(
      verifyWorkflowSurveyToken({
        token: yesUrl.searchParams.get("token"),
        secret: "secret",
        expectedAnswer: "yes",
        expectedWorkflow: "americas-onboarding-notices-sync",
      }),
    ).toEqual(
      expect.objectContaining({
        placementId: 123,
        candidateId: 456,
        ownerId: 99,
        answer: "yes",
      }),
    );
  });
});
