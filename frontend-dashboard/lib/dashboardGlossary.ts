export type GlossaryEntry = {
  label: string;
  description: string;
};

const SKIP_REASONS: Record<string, GlossaryEntry> = {
  "skipped-no-status-change": {
    label: "No status change",
    description: "The event was checked, but it did not include a placement status change for this workflow to act on.",
  },
  "placement-not-found": {
    label: "Placement not found",
    description: "Bullhorn sent an event for a placement that could no longer be loaded.",
  },
  "missing-transaction-id-for-status-change": {
    label: "Missing status-change reference",
    description: "The event showed a status change, but Bullhorn did not provide the transaction ID needed to confirm the old and new values.",
  },
  "placement-not-eligible-for-database-enrichment": {
    label: "Placement not eligible",
    description: "The placement did not match the workflow rules for a database enrichment update.",
  },
  "placement-not-eligible": {
    label: "Placement not eligible",
    description: "The placement was reviewed but did not match this workflow's business rules.",
  },
  "change-placement-not-eligible": {
    label: "Status change not eligible",
    description: "A placement change was found, but the old and new values did not match the workflow's trigger rules.",
  },
  "date-begin-placement-not-eligible": {
    label: "Start date not eligible",
    description: "The placement's start date was checked but was not due for this workflow's scheduled action.",
  },
  "status-change-placement-not-eligible": {
    label: "Status change not eligible",
    description: "The placement status changed, but the new status or placement details did not match this workflow's rules.",
  },
  "rule-filter-mismatch": {
    label: "Rule filter mismatch",
    description: "The record was checked but did not meet the workflow's configured business filters.",
  },
  "job-order-filter-mismatch": {
    label: "Job order filter mismatch",
    description: "The related job order was checked but did not match the workflow's required state, type, owner, or source filters.",
  },
  "non-interview-appointment": {
    label: "Not an interview",
    description: "The appointment event was not an interview, so the interview notification workflow skipped it.",
  },
  "edit-history-missing-status-change": {
    label: "Status change not found",
    description: "The workflow could not find the expected status-change record in Bullhorn edit history.",
  },
  "edit-history-missing-termination-reason-change": {
    label: "Termination reason change not found",
    description: "The workflow could not find the expected termination-reason change in Bullhorn edit history.",
  },
  "skipped-missing-owner-email": {
    label: "Missing owner email",
    description: "The workflow found a matching record, but the expected owner email address was missing.",
  },
  "skipped-rule-filter-mismatch": {
    label: "Rule filter mismatch",
    description: "The record was checked but did not meet the workflow's business rules.",
  },
  "skipped-no-patch": {
    label: "No update available",
    description: "The workflow did not find enough matching data to build an update.",
  },
  "skipped-no-change": {
    label: "No field change",
    description: "The workflow compared the record and found that the target values were already correct.",
  },
  "contact-already-do-not-contact": {
    label: "Contact already DNC",
    description: "The client contact was already marked Do Not Contact, so no update was needed.",
  },
  "client-corporation-not-do-not-contact": {
    label: "Company not DNC",
    description: "The related company was not marked Do Not Contact, so the contact did not need to be opted out.",
  },
  "postgres-not-configured-or-no-records": {
    label: "No PostgreSQL records written",
    description: "PostgreSQL reporting was not configured for this run, or there were no records to write.",
  },
  "dry-run": {
    label: "Dry-run only",
    description: "The workflow identified a match but did not perform the live action because DRY_RUN was enabled.",
  },
  "duplicate-event": {
    label: "Duplicate event",
    description: "More than one queued event referred to the same record in this run, so only one was processed.",
  },
  "skipped-duplicate-event": {
    label: "Duplicate event",
    description: "More than one queued event referred to the same record in this run, so only one was processed.",
  },
};

const ACTION_DECISIONS: Record<string, GlossaryEntry> = {
  "sent-email": {
    label: "Email sent",
    description: "The workflow sent an email through SparkPost.",
  },
  "would-send-email": {
    label: "Email would send",
    description: "The workflow matched an email recipient, but DRY_RUN was enabled so no email was sent.",
  },
  updated: {
    label: "Updated",
    description: "The workflow wrote a change back to Bullhorn or the reporting store.",
  },
  "would-update": {
    label: "Would update",
    description: "The workflow found a change to make, but DRY_RUN was enabled so no write was performed.",
  },
  "sent-survey": {
    label: "Survey sent",
    description: "The workflow sent a survey email and created tracking for the response.",
  },
  "would-send-survey": {
    label: "Survey would send",
    description: "The workflow matched a survey recipient, but DRY_RUN was enabled so no survey was sent.",
  },
  "sent-reminder": {
    label: "Reminder sent",
    description: "The workflow sent a reminder email for a previously tracked item.",
  },
  "would-send-reminder": {
    label: "Reminder would send",
    description: "The workflow found a reminder that was due, but DRY_RUN was enabled so no reminder was sent.",
  },
  "dry-run": {
    label: "Dry-run action",
    description: "The workflow identified an action but intentionally did not write because DRY_RUN was enabled.",
  },
  "placement-not-eligible-for-database-enrichment": {
    label: "Placement not eligible",
    description: "The placement was reviewed but did not match the database enrichment update rules.",
  },
  "missing-transaction-id-for-status-change": {
    label: "Missing status-change reference",
    description: "The event showed a status change, but Bullhorn did not provide the transaction ID needed to confirm the old and new values.",
  },
  skipped: {
    label: "Skipped",
    description: "The workflow checked the record and decided not to process it.",
  },
  failed: {
    label: "Failed",
    description: "The workflow attempted the action but encountered an error.",
  },
};

function toTitleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function describeUnknownEntry(kind: "skipReason" | "actionDecision", key: string, label: string) {
  if (!key) {
    return kind === "skipReason"
      ? "The workflow reported a skipped record without a specific reason."
      : "The workflow reported an action without a specific decision.";
  }

  if (key.startsWith("skipped-no-")) {
    return `The workflow checked the record, but there was no ${label.replace(/^Skipped No /, "").toLowerCase()} for it to process.`;
  }

  if (key.startsWith("skipped-missing-") || key.startsWith("missing-")) {
    return `The workflow could not process the record because ${label.replace(/^Skipped Missing |^Missing /, "").toLowerCase()} was missing.`;
  }

  if (key.includes("not-eligible")) {
    return "The record was reviewed but did not meet this workflow's eligibility rules.";
  }

  if (key.includes("filter-mismatch")) {
    return "The record was reviewed but did not match one or more configured workflow filters.";
  }

  if (key.includes("no-change")) {
    return "The workflow compared the record and found that no data needed to change.";
  }

  if (key.includes("duplicate")) {
    return "The same record appeared more than once in the run, so the duplicate was skipped.";
  }

  if (key.startsWith("would-")) {
    return "The workflow found an action to take, but DRY_RUN was enabled so the live action was not performed.";
  }

  if (key.startsWith("sent-")) {
    return "The workflow completed this send action successfully.";
  }

  return kind === "skipReason"
    ? "The workflow skipped this record based on its configured business rules."
    : "The workflow recorded this as the outcome of an attempted or planned action.";
}

export function getDashboardGlossaryEntry(kind: "skipReason" | "actionDecision", key: string): GlossaryEntry {
  const normalizedKey = String(key || "").trim();
  const dictionary = kind === "skipReason" ? SKIP_REASONS : ACTION_DECISIONS;
  const entry = dictionary[normalizedKey];

  if (entry) {
    return entry;
  }

  return {
    label: toTitleCase(normalizedKey || "Unknown"),
    description: describeUnknownEntry(kind, normalizedKey, toTitleCase(normalizedKey || "Unknown")),
  };
}
