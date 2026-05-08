const {
  RULES,
  SCORE_OPTIONS,
  SURVEY_QUESTION_TEXT,
  WORKFLOW_NAME,
  buildInitialTransmission,
  buildReminderDueDates,
  getMatchDetails,
} = require("../src/utils/soHowDidWeDoFeedbackUtils");
const { verifyWorkflowSurveyToken } = require("../src/utils/workflowSurveyUtils");

describe("soHowDidWeDoFeedbackUtils", () => {
  test("matches eligible client exit contract placement case-insensitively", () => {
    const rule = RULES.find((item) => item.key === "client-exit-contract");
    const details = getMatchDetails(
      {
        id: 5001,
        status: "Completed",
        employmentType: "Margin Only",
        owner: { id: 999, pager: "500" },
        candidate: {
          id: 7001,
          firstName: "Ava",
          owner: { primaryDepartment: { name: "HOU - Contract O&G" } },
        },
        clientContact: { id: 8001, firstName: "Maya", email: "maya@example.com" },
        billingClientContact: { id: 8002 },
        clientCorporation: { id: 2001, name: "Client Co" },
      },
      rule,
    );

    expect(details.matched).toBe(true);
  });

  test("blocks excluded perm candidate start placement by retain first name", () => {
    const rule = RULES.find((item) => item.key === "candidate-start-perm");
    const details = getMatchDetails(
      {
        id: 5002,
        status: "Approved",
        employmentType: "Perm",
        owner: { pager: "500" },
        candidate: { id: 7002, firstName: "Retain Candidate", email: "retain@example.com" },
      },
      rule,
    );

    expect(details.matched).toBe(false);
    expect(details.failedChecks).toContain("candidateFirstNameAllowed");
  });

  test("builds monday reminder catch-up dates", () => {
    expect(buildReminderDueDates({ businessDateKey: "2026-05-11" })).toEqual([
      "2026-05-09",
      "2026-05-10",
      "2026-05-11",
    ]);
  });

  test("builds a single survey link that verifies against the generic workflow token helper", () => {
    const rule = RULES.find((item) => item.key === "candidate-start-contract");
    const transmission = buildInitialTransmission({
      rule,
      config: {
        WORKFLOW_SURVEY_RESPONSE_BASE_URL: "https://example.com/respond",
        WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET: "secret",
      },
      businessDateKey: "2026-05-07",
      placement: {
        id: 123,
        status: "Approved",
        employmentType: "Contract",
        owner: { id: 9, email: "owner@example.com", pager: "500" },
        candidate: {
          id: 456,
          firstName: "Ava",
          lastName: "Tan",
          email: "ava@example.com",
          owner: { primaryDepartment: { name: "SIN - Production and Chemicals" } },
        },
        clientCorporation: { id: 99, name: "Client Co" },
      },
    });

    const url = new URL(transmission.tracking.surveyUrl);
    const payload = verifyWorkflowSurveyToken({
      token: url.searchParams.get("token"),
      secret: "secret",
      expectedWorkflow: WORKFLOW_NAME,
      allowMissingAnswer: true,
    });

    expect(SCORE_OPTIONS).toHaveLength(10);
    expect(transmission.content.html).toContain(SURVEY_QUESTION_TEXT);
    expect(transmission.content.html).toContain("Share feedback");
    expect(transmission.tracking.surveyUrl).toContain("token=");
    expect(transmission.audit.workflowName).toBe(WORKFLOW_NAME);
    expect(transmission.audit.sendType).toBe("initial");
    expect(payload.answer).toBeNull();
    expect(payload.surveyKey).toBeTruthy();
    expect(payload.trackingPartitionKey).toContain(WORKFLOW_NAME);
  });
});
