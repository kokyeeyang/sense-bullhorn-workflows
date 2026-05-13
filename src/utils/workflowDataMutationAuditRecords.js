function normalizeAction(mode, dryRun) {
  if (mode === "updated" && !dryRun) {
    return "updated";
  }

  if (mode === "failed") {
    return "failed";
  }

  return "would-update";
}

function toText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function compactDetails(details) {
  return Object.fromEntries(
    Object.entries(details || {}).filter(([, value]) => value !== undefined),
  );
}

function buildRowsFromChanges({
  workflowName,
  generatedAt,
  dryRun,
  record,
  entityType,
  entityId,
  relatedEntityType = "",
  relatedEntityId = null,
  candidateId = null,
  placementId = null,
  clientContactId = null,
  clientCorporationId = null,
  transactionId = "",
  reason = "",
  details = {},
}) {
  const changes = Array.isArray(record?.changes) ? record.changes : [];

  return changes.map((change) => ({
    workflowName,
    generatedAt,
    dryRun: Boolean(dryRun),
    action: normalizeAction(record?.mode, dryRun),
    entityType,
    entityId: entityId ?? null,
    relatedEntityType,
    relatedEntityId: relatedEntityId ?? null,
    candidateId: candidateId ?? null,
    placementId: placementId ?? null,
    clientContactId: clientContactId ?? null,
    clientCorporationId: clientCorporationId ?? null,
    transactionId: transactionId || "",
    fieldName: change.field || "",
    oldValue: change.oldValue ?? null,
    newValue: change.newValue ?? null,
    oldValueText: toText(change.oldValue),
    newValueText: toText(change.newValue),
    reason,
    details: compactDetails({
      ...details,
      sourceRecord: record,
    }),
  }));
}

function buildCandidateRows({ workflowName, report }) {
  return (report.affectedCandidates || []).flatMap((record) =>
    buildRowsFromChanges({
      workflowName,
      generatedAt: report.generatedAt,
      dryRun: report.dryRun,
      record,
      entityType: "candidate",
      entityId: record.candidateId,
      relatedEntityType: record.placementId ? "placement" : "",
      relatedEntityId: record.placementId || null,
      candidateId: record.candidateId,
      placementId: record.placementId || null,
      transactionId: record.transactionId || "",
      reason: record.matchReason || record.mappingType || record.ruleType || "",
      details: {
        mappingType: record.mappingType,
        matchReason: record.matchReason,
        ruleType: record.ruleType,
        areaCode: record.areaCode,
        callingCode: record.callingCode,
        statusChange: record.statusChange,
      },
    }),
  );
}

function buildClientContactRows({ workflowName, report }) {
  return (report.affectedContacts || []).flatMap((record) =>
    buildRowsFromChanges({
      workflowName,
      generatedAt: report.generatedAt,
      dryRun: report.dryRun,
      record,
      entityType: "client-contact",
      entityId: record.clientContactId,
      relatedEntityType: record.clientCorporationId ? "client-corporation" : "",
      relatedEntityId: record.clientCorporationId || null,
      clientContactId: record.clientContactId,
      clientCorporationId: record.clientCorporationId || null,
      reason: record.patchType || record.source || "",
      details: {
        source: record.source,
        patchType: record.patchType,
        contact: record.contact,
        clientCorporation: record.clientCorporation,
      },
    }),
  );
}

function buildClientCorporationRows({ workflowName, report }) {
  return (report.affectedClientCorporations || []).flatMap((record) =>
    buildRowsFromChanges({
      workflowName,
      generatedAt: report.generatedAt,
      dryRun: report.dryRun,
      record,
      entityType: "client-corporation",
      entityId: record.clientCorporationId,
      clientCorporationId: record.clientCorporationId,
      reason: workflowName,
    }),
  );
}

function buildWorkflowDataMutationAuditRecords({ workflowName, report }) {
  if (!report || !workflowName) {
    return [];
  }

  if (
    workflowName === "candidate-state-sync" ||
    workflowName === "placement-status-sync" ||
    workflowName === "placement-database-enrichment-sync"
  ) {
    return buildCandidateRows({ workflowName, report });
  }

  if (workflowName === "client-contact-dnc-sync") {
    return buildClientContactRows({ workflowName, report });
  }

  if (
    workflowName === "client-corporation-360-sync" ||
    workflowName === "client-corporation-key-account-sync"
  ) {
    return buildClientCorporationRows({ workflowName, report });
  }

  return [];
}

module.exports = {
  buildWorkflowDataMutationAuditRecords,
};
