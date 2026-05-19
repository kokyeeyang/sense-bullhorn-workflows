const {
  buildDateEndQueryDates,
  buildRuleExecutionPlan,
  buildTransmission,
  getMatchDetails,
} = require("../src/utils/usClientExtensionNotificationUtils");
const { verifyWorkflowSurveyToken } = require("../src/utils/workflowSurveyUtils");

describe("usClientExtensionNotificationUtils", () => {
  test("matches eligible US client extension placement", () => {
    const details = getMatchDetails({
      status: "Approved",
      employmentType: "Margin Only",
      owner: {
        primaryDepartment: { name: "HOU - Contract O&G" },
      },
      clientCorporation: { id: 1000 },
    });

    expect(details.matched).toBe(true);
  });

  test("blocks excluded client corporation", () => {
    const details = getMatchDetails({
      status: "Approved",
      employmentType: "Contract",
      owner: {
        primaryDepartment: { name: "Houston" },
      },
      clientCorporation: { id: 12949 },
    });

    expect(details.matched).toBe(false);
    expect(details.failedChecks).toContain("clientCorporationAllowed");
  });

  test("builds Friday and Monday date-end catch-up windows", () => {
    expect(buildDateEndQueryDates({ businessDateKey: "2026-05-15" })).toEqual([
      "2026-06-26",
      "2026-06-27",
    ]);
    expect(buildDateEndQueryDates({ businessDateKey: "2026-05-18" })).toEqual([
      "2026-06-29",
      "2026-06-28",
    ]);
  });

  test("only runs at the configured Pacific hour unless forced", () => {
    expect(buildRuleExecutionPlan({
      businessDateKey: "2026-05-18",
      businessHour: 7,
    }).queryDateEndDates).toEqual([]);
    expect(buildRuleExecutionPlan({
      businessDateKey: "2026-05-18",
      businessHour: 7,
      force: true,
    }).queryDateEndDates).toHaveLength(2);
  });

  test("builds a survey transmission with verifiable yes/no links", () => {
    const transmission = buildTransmission({
      businessDateKey: "2026-05-18",
      config: {
        WORKFLOW_SURVEY_RESPONSE_BASE_URL: "https://example.com/respond",
        WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET: "secret",
      },
      placement: {
        id: 123,
        status: "Approved",
        employmentType: "Contract",
        dateEnd: 1782604800000,
        owner: {
          id: 10,
          firstName: "Ava",
          lastName: "Owner",
          email: "owner@example.com",
          primaryDepartment: { name: "Denver" },
        },
        candidate: {
          id: 20,
          firstName: "Sam",
          lastName: "Contractor",
        },
        clientContact: {
          id: 30,
          firstName: "Mia",
          lastName: "Client",
          email: "client@example.com",
        },
        clientCorporation: { id: 40, name: "Client Co" },
      },
    });

    const yesUrl = new URL(transmission.tracking.context.surveyUrl || transmission.content.html.match(/https:\/\/example\.com[^"]+/)?.[0]);
    const payload = verifyWorkflowSurveyToken({
      token: yesUrl.searchParams.get("token"),
      secret: "secret",
      expectedAnswer: "yes",
      expectedWorkflow: "us-client-extension-notification-sync",
      allowedAnswers: ["yes", "no"],
    });

    expect(transmission.recipientEnvelope.toEmail).toBe("client@example.com");
    expect(transmission.content.from.email).toBe("owner@example.com");
    expect(payload.placementId).toBe(123);
    expect(payload.answer).toBe("yes");
  });
});
