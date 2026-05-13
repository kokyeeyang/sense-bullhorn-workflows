const {
  buildWorkflowDataMutationAuditRecords,
} = require("../src/utils/workflowDataMutationAuditRecords");

describe("buildWorkflowDataMutationAuditRecords", () => {
  test("builds candidate state audit rows from affected candidate changes", () => {
    const records = buildWorkflowDataMutationAuditRecords({
      workflowName: "candidate-state-sync",
      report: {
        generatedAt: "2026-05-13T08:00:00.000Z",
        dryRun: true,
        affectedCandidates: [
          {
            candidateId: 123,
            mode: "dry-run",
            mappingType: "mobile-area-code",
            areaCode: "713",
            callingCode: "+1",
            changes: [
              { field: "state", oldValue: null, newValue: "Texas" },
              { field: "countryName", oldValue: "", newValue: "United States" },
            ],
          },
        ],
      },
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      workflowName: "candidate-state-sync",
      dryRun: true,
      action: "would-update",
      entityType: "candidate",
      entityId: 123,
      candidateId: 123,
      fieldName: "state",
      oldValue: null,
      newValue: "Texas",
      reason: "mobile-area-code",
    });
  });

  test("builds placement-related candidate rows for placement database enrichment", () => {
    const records = buildWorkflowDataMutationAuditRecords({
      workflowName: "placement-database-enrichment-sync",
      report: {
        generatedAt: "2026-05-13T08:00:00.000Z",
        dryRun: false,
        affectedCandidates: [
          {
            placementId: 456,
            candidateId: 123,
            mode: "updated",
            matchReason: "status-transition",
            transactionId: "tx-1",
            changes: [{ field: "companyName", oldValue: "Old", newValue: "New" }],
          },
        ],
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "updated",
      entityType: "candidate",
      entityId: 123,
      relatedEntityType: "placement",
      relatedEntityId: 456,
      candidateId: 123,
      placementId: 456,
      transactionId: "tx-1",
      fieldName: "companyName",
      reason: "status-transition",
    });
  });

  test("builds client contact and client corporation rows", () => {
    const contactRecords = buildWorkflowDataMutationAuditRecords({
      workflowName: "client-contact-dnc-sync",
      report: {
        generatedAt: "2026-05-13T08:00:00.000Z",
        dryRun: false,
        affectedContacts: [
          {
            clientContactId: 10,
            clientCorporationId: 20,
            mode: "updated",
            source: "client-corporation-status-event",
            patchType: "set-do-not-contact",
            changes: [{ field: "status", oldValue: "Active", newValue: "Do Not Contact" }],
          },
        ],
      },
    });
    const corporationRecords = buildWorkflowDataMutationAuditRecords({
      workflowName: "client-corporation-key-account-sync",
      report: {
        generatedAt: "2026-05-13T08:00:00.000Z",
        dryRun: true,
        affectedClientCorporations: [
          {
            clientCorporationId: 20,
            mode: "dry-run",
            changes: [{ field: "customText7", oldValue: null, newValue: "Key Account" }],
          },
        ],
      },
    });

    expect(contactRecords[0]).toMatchObject({
      entityType: "client-contact",
      entityId: 10,
      relatedEntityType: "client-corporation",
      relatedEntityId: 20,
      clientContactId: 10,
      clientCorporationId: 20,
      reason: "set-do-not-contact",
    });
    expect(corporationRecords[0]).toMatchObject({
      action: "would-update",
      entityType: "client-corporation",
      entityId: 20,
      clientCorporationId: 20,
      fieldName: "customText7",
    });
  });
});
