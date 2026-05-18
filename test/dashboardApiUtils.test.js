const {
  buildAiMetricsContext,
  buildDashboardSummary,
  buildEmailSummary,
  buildWorkflowCatalog,
  resolveDashboardFilters,
} = require("../src/utils/dashboardApiUtils");

describe("dashboardApiUtils", () => {
  test("resolves default filters to a bounded seven day range", () => {
    const filters = resolveDashboardFilters({
      today: new Date("2026-05-15T12:00:00.000Z"),
    });

    expect(filters).toMatchObject({
      dateFrom: "2026-05-09",
      dateTo: "2026-05-15",
      workflowNames: [],
      rangeDays: 7,
    });
  });

  test("rejects unsupported workflow filters", () => {
    expect(() =>
      resolveDashboardFilters({
        dateFrom: "2026-05-01",
        dateTo: "2026-05-02",
        workflowName: "not-a-real-workflow",
      }),
    ).toThrow("Unsupported workflowName filter");
  });

  test("builds dashboard summary from aggregate records", () => {
    const filters = resolveDashboardFilters({
      dateFrom: "2026-05-14",
      dateTo: "2026-05-15",
      workflowName: "job-application-notification-sync,placement-status-sync",
    });
    const summary = buildDashboardSummary({
      environment: "production",
      filters,
      records: [
        {
          workflowName: "job-application-notification-sync",
          runDate: "2026-05-14",
          totalRuns: 1,
          successfulRuns: 1,
          failedRuns: 0,
          successCount: 2,
          skippedCount: 3,
          sentEmailCount: 2,
          totalEmailCount: 2,
          skippedActionCount: 1,
          actionDecisionCounts: { "sent-email": 2, "skipped-rule-filter-mismatch": 1 },
          skipReasonCounts: { "skipped-rule-filter-mismatch": 1 },
          fieldCounts: {},
          entityTypeCounts: { jobSubmission: 3 },
          lastRunAt: "2026-05-14T08:00:00.000Z",
          lastRunStatus: "success",
          lastSummary: "sent two emails",
        },
        {
          workflowName: "placement-status-sync",
          runDate: "2026-05-15",
          totalRuns: 1,
          successfulRuns: 0,
          failedRuns: 1,
          failureCount: 1,
          updatedCount: 0,
          wouldUpdateCount: 4,
          actionDecisionCounts: { "would-update": 4 },
          fieldCounts: { status: 4 },
          entityTypeCounts: { placement: 4 },
          lastRunAt: "2026-05-15T08:00:00.000Z",
          lastRunStatus: "failed",
          lastSummary: "failed run",
        },
      ],
    });

    expect(summary.totals).toMatchObject({
      workflowCount: 2,
      recordCount: 2,
      totalRuns: 2,
      successfulRuns: 1,
      failedRuns: 1,
      sentEmailCount: 2,
      wouldUpdateCount: 4,
      skippedActionCount: 1,
    });
    expect(summary.topActionDecisions).toEqual([
      { key: "would-update", count: 4 },
      { key: "sent-email", count: 2 },
      { key: "skipped-rule-filter-mismatch", count: 1 },
    ]);
    expect(summary.trends).toHaveLength(2);
  });

  test("builds compact email and AI summaries", () => {
    const filters = resolveDashboardFilters({
      dateFrom: "2026-05-15",
      dateTo: "2026-05-15",
    });
    const records = [
      {
        workflowName: "approved-placement-apac-sync",
        runDate: "2026-05-15",
        totalRuns: 1,
        successfulRuns: 1,
        sentEmailCount: 3,
        totalEmailCount: 3,
        actionDecisionCounts: { "sent-email": 3 },
        skipReasonCounts: {},
      },
      {
        workflowName: "placement-status-sync",
        runDate: "2026-05-15",
        totalRuns: 1,
        successfulRuns: 1,
        updatedCount: 3,
        actionDecisionCounts: { updated: 3 },
        skipReasonCounts: {},
      },
    ];

    const emailSummary = buildEmailSummary({
      environment: "production",
      filters,
      records,
    });
    const aiContext = buildAiMetricsContext({
      summary: buildDashboardSummary({
        environment: "production",
        filters,
        records,
      }),
    });

    expect(emailSummary.totals).toMatchObject({
      workflowCount: 1,
      totalEmails: 3,
      sentEmail: 3,
    });
    expect(aiContext.workflows[0]).not.toHaveProperty("records");
  });

  test("catalog includes newly migrated email workflows", () => {
    const catalog = buildWorkflowCatalog();
    const jobApplicationWorkflow = catalog.find(
      (workflow) => workflow.workflowName === "job-application-notification-sync",
    );
    const awrWorkflow = catalog.find((workflow) => workflow.workflowName === "awr-client-request-sync");

    expect(jobApplicationWorkflow).toMatchObject({
      label: "Job Application Notification",
      category: "email",
      sendsEmail: true,
    });
    expect(awrWorkflow).toMatchObject({
      category: "email",
      sendsEmail: true,
    });
    expect(catalog.find((workflow) => workflow.workflowName === "vestas-po-sync")).toBeUndefined();
  });
});
