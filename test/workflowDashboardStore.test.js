const {
  buildDashboardRunDelta,
  mergeMetrics,
} = require("../src/stores/workflowDashboardStore");

describe("workflowDashboardStore", () => {
  test("builds aggregate metrics from normalized comparison records", () => {
    const delta = buildDashboardRunDelta({
      workflowName: "placement-termination-workflows-sync",
      finishedAt: "2026-05-06T10:00:00.000Z",
      status: "success",
      summary: {
        successCount: 4,
        failureCount: 0,
        skippedCount: 3,
        summary: "test summary",
        artifactPath: "/tmp/reports/test.json",
      },
      comparisonRecords: [
        {
          actionDecision: "sent-email",
          recordType: "matched-placement",
          entityType: "placement",
          details: { stage: "day-10", changes: [{ field: "status" }] },
        },
        {
          actionDecision: "would-update",
          recordType: "affected-candidate",
          entityType: "candidate",
          details: { changes: [{ field: "email" }, { field: "status" }] },
        },
        {
          actionDecision: "skipped-missing-to-email",
          recordType: "skipped-placement",
          entityType: "placement",
          details: {},
        },
      ],
    });

    expect(delta).toMatchObject({
      workflowName: "placement-termination-workflows-sync",
      runDate: "2026-05-06",
      totalRuns: 1,
      successfulRuns: 1,
      failedRuns: 0,
      successCount: 4,
      skippedCount: 3,
      comparisonRecordCount: 3,
      sentEmailCount: 1,
      wouldUpdateCount: 1,
      skippedActionCount: 1,
      fieldChangeCount: 3,
      actionDecisionCounts: {
        "sent-email": 1,
        "would-update": 1,
        "skipped-missing-to-email": 1,
      },
      fieldCounts: {
        status: 2,
        email: 1,
      },
      stageCounts: {
        "day-10": 1,
      },
    });
  });

  test("merges metrics across multiple runs on the same day", () => {
    const merged = mergeMetrics(
      {
        totalRuns: 1,
        successfulRuns: 1,
        failedRuns: 0,
        successCount: 2,
        failureCount: 0,
        skippedCount: 1,
        comparisonRecordCount: 2,
        updatedCount: 1,
        wouldUpdateCount: 0,
        sentEmailCount: 1,
        wouldSendEmailCount: 0,
        totalEmailCount: 1,
        skippedActionCount: 1,
        fieldChangeCount: 2,
        actionDecisionCounts: { updated: 1, "sent-email": 1 },
        recordTypeCounts: { "matched-placement": 1 },
        entityTypeCounts: { placement: 1 },
        fieldCounts: { status: 1 },
        stageCounts: {},
        skipReasonCounts: { "skipped-missing-owner-email": 1 },
        firstRunAt: "2026-05-06T01:00:00.000Z",
        lastRunAt: "2026-05-06T01:00:00.000Z",
      },
      {
        workflowName: "placement-status-sync",
        runDate: "2026-05-06",
        monthKey: "2026-05",
        totalRuns: 1,
        successfulRuns: 0,
        failedRuns: 1,
        successCount: 0,
        failureCount: 1,
        skippedCount: 2,
        comparisonRecordCount: 1,
        updatedCount: 0,
        wouldUpdateCount: 1,
        sentEmailCount: 0,
        wouldSendEmailCount: 1,
        totalEmailCount: 1,
        skippedActionCount: 0,
        fieldChangeCount: 1,
        actionDecisionCounts: { "would-update": 1 },
        recordTypeCounts: { "affected-candidate": 1 },
        entityTypeCounts: { candidate: 1 },
        fieldCounts: { email: 1 },
        stageCounts: {},
        skipReasonCounts: {},
        firstRunAt: "2026-05-06T02:00:00.000Z",
        lastRunAt: "2026-05-06T02:00:00.000Z",
        lastRunAtDisplay: "06 May 2026, 02:00:00 UTC",
        lastRunStatus: "failed",
        lastSummary: "failed summary",
        artifactPath: "/tmp/reports/two.json",
        lastUpdatedAt: "2026-05-06T02:00:00.000Z",
      },
    );

    expect(merged).toMatchObject({
      totalRuns: 2,
      successfulRuns: 1,
      failedRuns: 1,
      successCount: 2,
      failureCount: 1,
      skippedCount: 3,
      comparisonRecordCount: 3,
      updatedCount: 1,
      wouldUpdateCount: 1,
      sentEmailCount: 1,
      wouldSendEmailCount: 1,
      totalEmailCount: 2,
      fieldChangeCount: 3,
      actionDecisionCounts: {
        updated: 1,
        "sent-email": 1,
        "would-update": 1,
      },
      fieldCounts: {
        status: 1,
        email: 1,
      },
    });
  });
});
