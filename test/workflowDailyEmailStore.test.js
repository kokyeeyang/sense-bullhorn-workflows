const { buildDailyEmailRecords } = require("../src/stores/workflowDailyEmailStore");

describe("workflowDailyEmailStore", () => {
  test("extracts email-oriented records from workflow comparison records", () => {
    const records = buildDailyEmailRecords({
      records: [
        {
          generatedAt: "2026-04-15T00:05:00.000Z",
          sourceSystem: "azure-functions",
          workflowName: "placement-termination-email-sync",
          recordType: "matched-placement",
          actionDecision: "would-send-email",
          entityType: "placement",
          entityId: 123,
          transactionId: "tx-1",
          candidateId: 456,
          relatedId: 789,
          details: {
            recipientEmail: "owner@example.com",
            ccEmails: ["candidate.owner@example.com"],
            stage: "day-21",
            statusChange: {
              oldValue: "approved",
              newValue: "terminated",
            },
          },
        },
        {
          generatedAt: "2026-04-15T00:10:00.000Z",
          sourceSystem: "azure-functions",
          workflowName: "placement-status-sync",
          recordType: "affected-candidate",
          actionDecision: "would-update",
          entityType: "placement",
          entityId: 999,
          details: {
            changes: [{ field: "status", oldValue: "old", newValue: "new" }],
          },
        },
      ],
    });

    expect(records).toEqual([
      {
        generatedAt: "2026-04-15T00:05:00.000Z",
        sourceSystem: "azure-functions",
        workflowName: "placement-termination-email-sync",
        recordType: "matched-placement",
        actionDecision: "would-send-email",
        entityType: "placement",
        entityId: 123,
        transactionId: "tx-1",
        candidateId: 456,
        relatedId: 789,
        recipientEmail: "owner@example.com",
        ccEmails: ["candidate.owner@example.com"],
        stage: "day-21",
        statusChange: {
          oldValue: "approved",
          newValue: "terminated",
        },
      },
    ]);
  });
});
