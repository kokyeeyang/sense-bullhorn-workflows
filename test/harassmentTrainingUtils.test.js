const {
  buildHarassmentTrainingTransmission,
  buildResponseToken,
  buildQueryPlan,
  findRuleForPlacement,
  hasHarassmentTrainingFlag,
  matchesCaliforniaPlacement,
  matchesConnecticutNewYorkPlacement,
  matchesIllinoisMainePlacement,
  verifyResponseToken,
} = require("../src/utils/harassmentTrainingUtils");

describe("harassmentTrainingUtils", () => {
  test("matches Illinois and Maine onboarding placements case-insensitively", () => {
    const placement = {
      status: "QC APPROVED",
      workState: "illinois",
      country: "UNITED STATES",
      customText7: "Sexual Harassment Training",
    };

    expect(hasHarassmentTrainingFlag(placement)).toBe(true);
    expect(matchesIllinoisMainePlacement(placement)).toBe(true);
    expect(findRuleForPlacement({ placement, source: "dateBegin" }).stateLabel).toBe("Illinois");
  });

  test("treats a known US work state as United States when country is blank", () => {
    expect(
      matchesIllinoisMainePlacement({
        status: "Submitted",
        jobOrder: {
          address: {
            state: "Illinois",
          },
        },
        customText7: "Sexual Harassment Training",
      }),
    ).toBe(true);
  });

  test("does not require Illinois and Maine training flag", () => {
    expect(
      matchesIllinoisMainePlacement({
        status: "Approved",
        workState: "Maine",
        country: "United States",
      }),
    ).toBe(true);
  });

  test("can temporarily include extra date-begin statuses", () => {
    expect(
      matchesIllinoisMainePlacement(
        {
          status: "Pre-Hire",
          workState: "Illinois",
          country: "United States",
          customText7: "Sexual Harassment Training",
        },
        {
          extraStatuses: "Pre-Hire",
        },
      ),
    ).toBe(true);
  });

  test("can use configured Bullhorn fields for the Illinois and Maine training flag", () => {
    const placement = {
      status: "Approved",
      workState: "Maine",
      country: "United States",
      customText31: "Sexual Harassment Training",
    };

    expect(
      matchesIllinoisMainePlacement(placement, {
        flagFields: "customText31",
      }),
    ).toBe(true);
  });

  test("matches Connecticut and New York contract approved status changes", () => {
    expect(
      matchesConnecticutNewYorkPlacement({
        placement: {
          employmentType: "CONTRACT",
          workState: "new york",
        },
        statusChange: {
          oldValue: "Submitted",
          newValue: "QC Approved",
        },
      }),
    ).toBe(true);
  });

  test("matches California only from submitted or pre-hire into approved status", () => {
    expect(
      matchesCaliforniaPlacement({
        placement: {
          employmentType: "contract",
          workState: "California",
          country: "US",
        },
        statusChange: {
          oldValue: "Pre-Hire",
          newValue: "Approved",
        },
      }),
    ).toBe(true);

    expect(
      matchesCaliforniaPlacement({
        placement: {
          employmentType: "contract",
          workState: "California",
          country: "United States",
        },
        statusChange: {
          oldValue: "Rejected",
          newValue: "Approved",
        },
      }),
    ).toBe(false);
  });

  test("builds weekend-aware query dates for delayed status-change sends", () => {
    expect(buildQueryPlan({ businessDateKey: "2026-04-20" }).statusChangeDateKeys).toEqual([
      "2026-04-17",
      "2026-04-18",
      "2026-04-19",
    ]);

    expect(buildQueryPlan({ businessDateKey: "2026-04-17" }).statusChangeDateKeys).toEqual([
      "2026-04-16",
      "2026-04-17",
    ]);
  });

  test("builds SparkPost recipients with dynamic sender, CC, and response links", () => {
    const transmission = buildHarassmentTrainingTransmission({
      templateId: "harassment-training",
      rule: {
        key: "illinois",
        stateLabel: "Illinois",
        workflowLabel: "Americas Illinois Onboarding - Anti Harassment Training",
        templateVariant: "onboarding-confirmation",
        requiresConfirmation: true,
      },
      config: {
        HARASSMENT_TRAINING_RESPONSE_BASE_URL: "https://example.com/respond",
        HARASSMENT_TRAINING_RESPONSE_SIGNING_SECRET: "secret",
      },
      attachments: [
        {
          name: "illinois.pdf",
          type: "application/pdf",
          data: "abc",
        },
        {
          name: "policy.pdf",
          type: "application/pdf",
          data: "def",
        },
      ],
      placement: {
        id: 123,
        candidate: {
          id: 456,
          firstName: "Ava",
          lastName: "Tan",
          email: "ava@example.com",
          owner: {
            firstName: "Sam",
            lastName: "Owner",
            email: "sam.owner@example.com",
          },
        },
        clientCorporation: {
          name: "Client Co",
        },
      },
    });

    expect(transmission.from).toEqual({
      name: "Spencer Ogden",
      email: "sam.owner@example.com",
    });
    expect(transmission.headers).toEqual({ CC: "onboarding@spencer-ogden.com" });
    expect(transmission.recipients).toHaveLength(2);
    expect(transmission.recipients[0].substitution_data.response_url_yes).toContain(
      "answer=yes",
    );
    expect(transmission.attachments).toEqual([
      {
        name: "illinois.pdf",
        type: "application/pdf",
        data: "abc",
      },
      {
        name: "policy.pdf",
        type: "application/pdf",
        data: "def",
      },
    ]);
  });

  test("verifies signed response tokens and rejects answer tampering", () => {
    const token = buildResponseToken({
      secret: "secret",
      answer: "yes",
      rule: {
        stateLabel: "Maine",
      },
      placement: {
        id: 123,
        candidate: {
          id: 456,
          email: "ava@example.com",
        },
      },
    });

    expect(
      verifyResponseToken({
        token,
        secret: "secret",
        expectedAnswer: "yes",
      }),
    ).toEqual(
      expect.objectContaining({
        placementId: 123,
        candidateId: 456,
        candidateEmail: "ava@example.com",
        state: "Maine",
        answer: "yes",
      }),
    );

    expect(() =>
      verifyResponseToken({
        token,
        secret: "secret",
        expectedAnswer: "no",
      }),
    ).toThrow("Response answer does not match token");
  });
});
