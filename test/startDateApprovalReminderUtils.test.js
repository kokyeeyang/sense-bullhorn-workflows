const {
  buildStageQueryPlan,
  buildTransmission,
  getMatchDetails,
} = require("../src/utils/startDateApprovalReminderUtils");
const { verifyWorkflowSurveyToken } = require("../src/utils/workflowSurveyUtils");

describe("startDateApprovalReminderUtils", () => {
  test("builds Friday and Monday weekend-adjusted query dates for each stage", () => {
    const fridayPlan = buildStageQueryPlan({ businessDateKey: "2026-05-08" });
    expect(fridayPlan).toEqual([
      expect.objectContaining({
        key: "day-2",
        queryDateBeginDates: ["2026-05-06", "2026-05-07"],
      }),
      expect.objectContaining({
        key: "day-10",
        queryDateBeginDates: ["2026-04-28", "2026-04-29"],
      }),
    ]);

    const mondayPlan = buildStageQueryPlan({ businessDateKey: "2026-05-11" });
    expect(mondayPlan).toEqual([
      expect.objectContaining({
        key: "day-2",
        queryDateBeginDates: ["2026-05-08", "2026-05-09"],
      }),
      expect.objectContaining({
        key: "day-10",
        queryDateBeginDates: ["2026-04-30", "2026-05-01"],
      }),
    ]);
  });

  test("matches eligible placements by minimum date, status, and region pager", () => {
    const match = getMatchDetails({
      dateBegin: Date.UTC(2022, 11, 1),
      status: "QC Approved",
      owner: {
        pager: "500",
      },
    });

    expect(match).toEqual(
      expect.objectContaining({
        matched: true,
        region: "Americas",
      }),
    );

    expect(
      getMatchDetails({
        dateBegin: Date.UTC(2022, 10, 30),
        status: "QC Approved",
        owner: {
          pager: "500",
        },
      }).matched,
    ).toBe(false);
  });

  test("builds stage-specific subjects and survey links for Americas only", () => {
    const americasTransmission = buildTransmission({
      config: {
        WORKFLOW_SURVEY_RESPONSE_BASE_URL: "https://example.com/respond",
        WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET: "secret",
      },
      stage: {
        key: "day-2",
        daysAfterDateBegin: 2,
        subjectPrefix: "2 days after",
      },
      regionRule: {
        label: "Americas",
        requiresSurvey: true,
      },
      placement: {
        id: 123,
        status: "Pre-Hire",
        owner: {
          id: 99,
          firstName: "Sam",
          email: "sam@example.com",
        },
        candidate: {
          id: 456,
          firstName: "Ava",
          lastName: "Tan",
        },
        clientCorporation: {
          name: "Client Co",
        },
        jobOrder: {
          owner: {
            reportToPerson: {
              email: "manager@example.com",
            },
          },
        },
      },
    });

    expect(americasTransmission.content.subject).toBe(
      "2 days after Placement Start Date Approval Status Reminder 123 - Ava Tan",
    );
    expect(americasTransmission.content.html).toContain("Have you attached your candidates/clients confirmation of start date to your placement?");
    expect(americasTransmission.content.html).toContain("answer=yes");
    expect(americasTransmission.content.headers).toEqual({ CC: "manager@example.com" });

    const yesToken = new URL(
      americasTransmission.content.html.match(/href="([^"]*answer=yes[^"]*)"/)[1],
    ).searchParams.get("token");
    expect(
      verifyWorkflowSurveyToken({
        token: yesToken,
        secret: "secret",
        expectedAnswer: "yes",
        expectedWorkflow: "start-date-approval-reminder-sync",
      }),
    ).toEqual(
      expect.objectContaining({
        placementId: 123,
        ownerId: 99,
        answer: "yes",
      }),
    );

    const apacTransmission = buildTransmission({
      config: {},
      stage: {
        key: "day-10",
        daysAfterDateBegin: 10,
        subjectPrefix: "10 days after",
      },
      regionRule: {
        label: "APAC",
        requiresSurvey: false,
      },
      placement: {
        id: 124,
        status: "QC Approved",
        owner: {
          firstName: "Jo",
          email: "jo@example.com",
        },
        candidate: {
          firstName: "Bea",
          lastName: "Lim",
        },
        clientCorporation: {
          name: "Client Co",
        },
        jobOrder: {
          owner: {},
        },
      },
    });

    expect(apacTransmission.content.subject).toBe(
      "10 days after Placement Start Date Approval Status Reminder 124 - Bea Lim",
    );
    expect(apacTransmission.content.html).not.toContain("answer=yes");
  });
});
