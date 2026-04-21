function normalizeChanges(changes) {
  if (!Array.isArray(changes)) {
    return [];
  }

  return changes.map((change) => {
    if (change && typeof change === "object" && "field" in change) {
      return change.field;
    }

    return String(change);
  });
}

function buildCommonRecord({ workflowName, generatedAt, recordType, actionDecision, details = {} }) {
  return {
    sourceSystem: "azure-functions",
    workflowName,
    generatedAt,
    recordType,
    actionDecision,
    details,
  };
}

function buildPlacementDatabaseEnrichmentRecords({ workflowName, generatedAt, report }) {
  const affected = (report.affectedCandidates || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "affected-candidate",
      actionDecision: record.mode === "dry-run" ? "would-update" : "updated",
      details: {
        mappingType: record.mappingType || null,
        matchReason: record.matchReason || null,
        ruleType: record.ruleType || null,
        changes: record.changes || [],
      },
    }),
    entityType: "placement",
    entityId: record.placementId ?? null,
    transactionId: record.transactionId || null,
    candidateId: record.candidateId ?? null,
    relatedId: null,
  }));

  const skipped = (report.skippedPlacements || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "skipped-placement",
      actionDecision: record.reason || "skipped",
      details: {
        updatedProperties: record.updatedProperties || [],
        employmentType: record.employmentType || null,
        oldValue: record.oldValue ?? null,
        newValue: record.newValue ?? null,
        dateLastModified: record.dateLastModified || null,
      },
    }),
    entityType: "placement",
    entityId: record.placementId ?? null,
    transactionId: record.transactionId || null,
    candidateId: null,
    relatedId: null,
  }));

  return [...affected, ...skipped];
}

function buildPlacementStatusRecords({ workflowName, generatedAt, report }) {
  return (report.affectedCandidates || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "affected-candidate",
      actionDecision: record.mode === "dry-run" ? "would-update" : "updated",
      details: {
        mappingType: record.mappingType || null,
        changes: record.changes || [],
      },
    }),
    entityType: "placement",
    entityId: record.placementId ?? null,
    transactionId: record.transactionId || null,
    candidateId: record.candidateId ?? null,
    relatedId: null,
  }));
}

function buildCandidateStateRecords({ workflowName, generatedAt, report }) {
  return (report.affectedCandidates || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "affected-candidate",
      actionDecision: record.mode === "dry-run" ? "would-update" : "updated",
      details: {
        mappingType: record.mappingType || null,
        areaCode: record.areaCode || null,
        callingCode: record.callingCode || null,
        changes: record.changes || [],
      },
    }),
    entityType: "candidate",
    entityId: record.candidateId ?? null,
    transactionId: null,
    candidateId: record.candidateId ?? null,
    relatedId: null,
  }));
}

function buildClientContactDncRecords({ workflowName, generatedAt, report }) {
  const affected = (report.affectedContacts || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "affected-contact",
      actionDecision: record.mode === "dry-run" ? "would-update" : "updated",
      details: {
        patchType: record.patchType || null,
        source: record.source || null,
        changes: record.changes || [],
      },
    }),
    entityType: "client-contact",
    entityId: record.clientContactId ?? null,
    transactionId: null,
    candidateId: null,
    relatedId: record.clientCorporationId ?? null,
  }));

  const skipped = (report.skippedContacts || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "skipped-contact",
      actionDecision: record.reason || "skipped",
      details: record,
    }),
    entityType: "client-contact",
    entityId: record.clientContactId ?? null,
    transactionId: null,
    candidateId: null,
    relatedId: record.clientCorporationId ?? null,
  }));

  return [...affected, ...skipped];
}

function buildClientCorporationRecords({ workflowName, generatedAt, report, actionLabel }) {
  const affected = (report.affectedClientCorporations || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "affected-client-corporation",
      actionDecision: record.mode === "dry-run" ? "would-update" : "updated",
      details: {
        actionLabel,
        changes: record.changes || [],
      },
    }),
    entityType: "client-corporation",
    entityId: record.clientCorporationId ?? null,
    transactionId: null,
    candidateId: null,
    relatedId: null,
  }));

  const skipped = [
    ...Array.from({ length: Number(report?.totals?.skippedDelayNotMet || 0) }, (_, index) => ({
      ...buildCommonRecord({
        workflowName,
        generatedAt,
        recordType: "skipped-client-corporation",
        actionDecision: "skipped-delay-not-met",
        details: {
          actionLabel,
          sequence: index + 1,
        },
      }),
      entityType: "client-corporation",
      entityId: null,
      transactionId: null,
      candidateId: null,
      relatedId: null,
    })),
    ...Array.from({ length: Number(report?.totals?.skippedNoPatch || 0) }, (_, index) => ({
      ...buildCommonRecord({
        workflowName,
        generatedAt,
        recordType: "skipped-client-corporation",
        actionDecision: "skipped-no-patch",
        details: {
          actionLabel,
          sequence: index + 1,
        },
      }),
      entityType: "client-corporation",
      entityId: null,
      transactionId: null,
      candidateId: null,
      relatedId: null,
    })),
    ...Array.from({ length: Number(report?.totals?.skippedNoChange || 0) }, (_, index) => ({
      ...buildCommonRecord({
        workflowName,
        generatedAt,
        recordType: "skipped-client-corporation",
        actionDecision: "skipped-no-change",
        details: {
          actionLabel,
          sequence: index + 1,
        },
      }),
      entityType: "client-corporation",
      entityId: null,
      transactionId: null,
      candidateId: null,
      relatedId: null,
    })),
  ];

  return [...affected, ...skipped];
}

function buildPlacementEmailRecords({ workflowName, generatedAt, report, entityKey, entityType }) {
  const matched = (report.placements || report.appointments || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: entityType === "appointment" ? "matched-appointment" : "matched-placement",
      actionDecision: report.dryRun ? "would-send-email" : "sent-email",
      details: {
        recipientEmail: record.owner?.email || record.sparkPostRecipient?.address?.email || null,
        statusChange: record.statusChange || null,
      },
    }),
    entityType,
    entityId: record[entityKey] ?? record.placement?.id ?? record.appointment?.id ?? null,
    transactionId: record.transactionId || null,
    candidateId: record.placement?.candidate?.id || record.appointment?.candidateReference?.id || null,
    relatedId: record.owner?.id || null,
  }));

  const skipped = [
    ...Array.from({ length: Number(report?.totals?.skippedNoStatusChange || 0) }, (_, index) => ({
      ...buildCommonRecord({
        workflowName,
        generatedAt,
        recordType: entityType === "appointment" ? "skipped-appointment" : "skipped-placement",
        actionDecision: "skipped-no-status-change",
        details: { sequence: index + 1 },
      }),
      entityType,
      entityId: null,
      transactionId: null,
      candidateId: null,
      relatedId: null,
    })),
    ...Array.from({ length: Number(report?.totals?.skippedWrongTransition || 0) }, (_, index) => ({
      ...buildCommonRecord({
        workflowName,
        generatedAt,
        recordType: entityType === "appointment" ? "skipped-appointment" : "skipped-placement",
        actionDecision: "skipped-wrong-transition",
        details: { sequence: index + 1 },
      }),
      entityType,
      entityId: null,
      transactionId: null,
      candidateId: null,
      relatedId: null,
    })),
    ...Array.from(
      { length: Number(report?.totals?.skippedMissingOwnerEmail || 0) },
      (_, index) => ({
        ...buildCommonRecord({
          workflowName,
          generatedAt,
          recordType: entityType === "appointment" ? "skipped-appointment" : "skipped-placement",
          actionDecision: "skipped-missing-owner-email",
          details: { sequence: index + 1 },
        }),
        entityType,
        entityId: null,
        transactionId: null,
        candidateId: null,
        relatedId: null,
      }),
    ),
  ];

  return [...matched, ...skipped];
}

function buildPlacementReminderRecords({ workflowName, generatedAt, report }) {
  return (report.placements || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "matched-placement",
      actionDecision: report.dryRun ? "would-send-email" : "sent-email",
      details: {
        recipientEmail:
          record.recipient?.toEmail ||
          record.owner?.email ||
          record.sparkPostRecipient?.address?.email ||
          null,
        ccEmails: record.recipient?.ccEmails || [],
        stage: record.stage?.label || null,
      },
    }),
    entityType: "placement",
    entityId: record.placementId ?? record.placement?.id ?? null,
    transactionId: null,
    candidateId: record.placement?.candidate?.id || null,
    relatedId: record.owner?.id || null,
  }));
}

function buildJobOrderEmailRecords({ workflowName, generatedAt, report }) {
  return (report.jobOrders || []).map((record) => ({
    ...buildCommonRecord({
      workflowName,
      generatedAt,
      recordType: "matched-job-order",
      actionDecision: report.dryRun ? "would-send-email" : "sent-email",
      details: {
        recipientEmail: record.owner?.email || record.sparkPostRecipient?.address?.email || null,
      },
    }),
    entityType: "job-order",
    entityId: record.jobOrderId ?? record.jobOrder?.id ?? null,
    transactionId: null,
    candidateId: null,
    relatedId: record.owner?.id || null,
  }));
}

function buildWorkflowComparisonRecords({ workflowName, result }) {
  const report = result?.report || {};
  const generatedAt = report.generatedAt || new Date().toISOString();

  switch (workflowName) {
    case "placement-database-enrichment-sync":
      return buildPlacementDatabaseEnrichmentRecords({ workflowName, generatedAt, report });
    case "placement-status-sync":
      return buildPlacementStatusRecords({ workflowName, generatedAt, report });
    case "candidate-state-sync":
      return buildCandidateStateRecords({ workflowName, generatedAt, report });
    case "client-contact-dnc-sync":
      return buildClientContactDncRecords({ workflowName, generatedAt, report });
    case "client-corporation-360-sync":
      return buildClientCorporationRecords({
        workflowName,
        generatedAt,
        report,
        actionLabel: "database-cleanup-360",
      });
    case "client-corporation-key-account-sync":
      return buildClientCorporationRecords({
        workflowName,
        generatedAt,
        report,
        actionLabel: "key-account-sync",
      });
    case "placement-termination-email-sync":
      return buildPlacementEmailRecords({
        workflowName,
        generatedAt,
        report,
        entityKey: "placementId",
        entityType: "placement",
      });
    case "interview-illinois-email-sync":
      return buildPlacementEmailRecords({
        workflowName,
        generatedAt,
        report,
        entityKey: "appointmentId",
        entityType: "appointment",
      });
    case "placement-start-reminder-sync":
    case "placement-benefits-reminder-sync":
    case "placement-yearly-fee-increase-sync":
      return buildPlacementReminderRecords({ workflowName, generatedAt, report });
    case "new-job-illinois-email-sync":
      return buildJobOrderEmailRecords({ workflowName, generatedAt, report });
    default:
      return [];
  }
}

module.exports = {
  buildWorkflowComparisonRecords,
  normalizeChanges,
};
