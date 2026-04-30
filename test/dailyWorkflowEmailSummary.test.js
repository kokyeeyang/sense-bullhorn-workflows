const { buildDailyEmailSummary } = require("../src/workflows/dailyWorkflowEmailSummary");

describe("dailyWorkflowEmailSummary", () => {
  test("builds per-workflow and aggregate email totals", () => {
    const summary = buildDailyEmailSummary({
      environment: "production",
      summaryDate: "2026-04-15",
      includeRecords: false,
      workflowRecords: [
        {
          workflowName: "placement-termination-email-sync",
          records: [
            { actionDecision: "would-send-email" },
            { actionDecision: "sent-email" },
          ],
        },
        {
          workflowName: "placement-start-reminder-sync",
          records: [{ actionDecision: "would-send-email" }],
        },
      ],
    });

    expect(summary).toEqual({
      generatedAt: expect.any(String),
      summaryDate: "2026-04-15",
      environment: "production",
      totals: {
        workflowCount: 2,
        totalEmails: 3,
        wouldSendEmail: 2,
        sentEmail: 1,
      },
      workflows: [
        {
          workflowName: "placement-termination-email-sync",
          totals: {
            totalEmails: 2,
            wouldSendEmail: 1,
            sentEmail: 1,
          },
          totalRecipientRows: 2,
        },
        {
          workflowName: "placement-start-reminder-sync",
          totals: {
            totalEmails: 1,
            wouldSendEmail: 1,
            sentEmail: 0,
          },
          totalRecipientRows: 1,
        },
      ],
    });
  });
});
