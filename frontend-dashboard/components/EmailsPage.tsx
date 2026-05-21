"use client";

import { useEffect, useState } from "react";
import { Binoculars, Mail, RefreshCcw, Search, X } from "lucide-react";
import { fetchEmailTransmissions, fetchWorkflowCatalog, type DashboardQuery } from "@/lib/dashboardApi";
import { EmailTransmissionRecord, EmailTransmissionsResponse, WorkflowCatalogItem } from "@/lib/types";
import { formatDateOnly, formatDateTime, formatNumber, getDefaultDateRange } from "@/lib/format";
import { PaginationControls, paginate } from "@/components/PaginationControls";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { sortWorkflowsByLabel, workflowLabel } from "@/lib/workflowDisplay";

function buildDefaultQuery(): DashboardQuery & Record<string, string> {
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  return {
    ...getDefaultDateRange(30),
    workflowName: params?.get("workflowName") || "",
    category: "",
    status: "",
    actionDecision: "",
    sendType: "",
    recipientEmail: "",
    fromEmail: "",
    subject: "",
    limit: "100",
  };
}

export function EmailsPage() {
  const [query, setQuery] = useState(buildDefaultQuery);
  const [catalog, setCatalog] = useState<WorkflowCatalogItem[]>([]);
  const [data, setData] = useState<EmailTransmissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedEmail, setSelectedEmail] = useState<EmailTransmissionRecord | null>(null);

  async function load(nextQuery = query) {
    setLoading(true);
    setError(null);

    try {
      const [workflowCatalog, result] = await Promise.all([
        fetchWorkflowCatalog(),
        fetchEmailTransmissions(nextQuery),
      ]);
      setCatalog(sortWorkflowsByLabel(workflowCatalog.filter((workflow) => workflow.sendsEmail)));
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Email transmissions failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateQuery(key: string, value: string) {
    setQuery((current) => ({ ...current, [key]: value }));
  }

  const records = data?.records || [];
  const pagination = paginate(records, page, pageSize);
  const uniqueRecipients = new Set(records.map((record) => record.recipientEmail).filter(Boolean)).size;

  return (
    <main className="pageShell">
      <header className="topBar">
        <div>
          <span className="eyebrow">Outbound Mail</span>
          <h1>Email Sends</h1>
        </div>
        <button type="button" className="iconButton" onClick={() => void load()} title="Refresh">
          <RefreshCcw size={18} />
        </button>
      </header>

      <section className="filterPanel detailFilters">
        <div className="filterTitle">
          <Mail size={18} />
          <span>Filters</span>
        </div>
        <label>
          From
          <input type="date" value={query.dateFrom} onChange={(event) => updateQuery("dateFrom", event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={query.dateTo} onChange={(event) => updateQuery("dateTo", event.target.value)} />
        </label>
        <label>
          Workflow
          <select value={query.workflowName} onChange={(event) => updateQuery("workflowName", event.target.value)}>
            <option value="">All</option>
            {catalog.map((workflow) => (
              <option key={workflow.workflowName} value={workflow.workflowName}>
                {workflow.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Send type
          <input value={query.sendType} onChange={(event) => updateQuery("sendType", event.target.value)} placeholder="initial" />
        </label>
        <label>
          Recipient
          <input
            value={query.recipientEmail}
            onChange={(event) => updateQuery("recipientEmail", event.target.value)}
            placeholder="client@example.com"
          />
        </label>
        <label>
          Sender
          <input
            value={query.fromEmail}
            onChange={(event) => updateQuery("fromEmail", event.target.value)}
            placeholder="noreply@..."
          />
        </label>
        <label>
          Subject
          <input value={query.subject} onChange={(event) => updateQuery("subject", event.target.value)} />
        </label>
        <button type="button" className="primaryButton" onClick={() => void load()}>
          <Search size={16} />
          Apply
        </button>
      </section>

      {error ? <section className="errorBanner">{error}</section> : null}

      <section className="metricGrid detailMetricGrid">
        <section className="metricCard">
          <div>
            <p>Email rows</p>
            {loading && !data ? <LoadingIndicator /> : <strong>{formatNumber(data?.count)}</strong>}
            <span>{data?.storage === "postgres" ? "PostgreSQL transmissions" : "No detail store configured"}</span>
          </div>
        </section>
        <section className="metricCard">
          <div>
            <p>Recipients</p>
            {loading && !data ? <LoadingIndicator /> : <strong>{formatNumber(uniqueRecipients)}</strong>}
          </div>
        </section>
        <section className="metricCard">
          <div>
            <p>Workflows</p>
            {loading && !data ? (
              <LoadingIndicator />
            ) : (
              <strong>{formatNumber(new Set(records.map((record) => record.workflowName)).size)}</strong>
            )}
          </div>
        </section>
      </section>

      <section className="panel fullWidth">
        <div className="panelHeader">
          <div>
            <span className="eyebrow">Transmissions</span>
            <h2>Sent Emails</h2>
          </div>
          {loading ? <LoadingIndicator /> : null}
        </div>
        {loading && !data ? (
          <LoadingIndicator label="Loading sent emails" />
        ) : (
          <div className="tableScroller detailTable">
            <table>
              <thead>
                <tr>
                  <th>Inspect</th>
                  <th>Sent</th>
                  <th>Workflow</th>
                  <th>Recipient</th>
                  <th>Sender</th>
                  <th>Subject</th>
                  <th>Type</th>
                  <th>Provider ID</th>
                  <th>Candidate</th>
                  <th>Placement</th>
                </tr>
              </thead>
              <tbody>
                {pagination.items.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <button
                        type="button"
                        className="iconButton small"
                        title="Inspect email"
                        onClick={() => setSelectedEmail(record)}
                      >
                        <Binoculars size={16} />
                      </button>
                    </td>
                    <td>{formatDateTime(record.sentAt)}</td>
                    <td>
                      <strong>{workflowLabel(record.workflowName, catalog)}</strong>
                      <span>{record.ruleKey || formatDateOnly(record.businessDate || record.runDate)}</span>
                    </td>
                    <td>
                      <strong>{record.recipientEmail || "-"}</strong>
                      <span>{record.recipientType || "-"}</span>
                    </td>
                    <td>
                      <strong>{record.fromEmail || "-"}</strong>
                      <span>{record.fromName || "-"}</span>
                    </td>
                    <td className="subjectCell">{record.subject || "-"}</td>
                    <td>{record.sendType || "-"}</td>
                    <td>{record.providerTransmissionId || record.providerMessageId || "-"}</td>
                    <td>{record.candidateId || "-"}</td>
                    <td>{record.placementId || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationControls
          page={pagination.page}
          pageSize={pageSize}
          totalItems={records.length}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
      </section>

      {selectedEmail ? (
        <EmailInspectModal email={selectedEmail} catalog={catalog} onClose={() => setSelectedEmail(null)} />
      ) : null}
    </main>
  );
}

function EmailInspectModal({
  email,
  catalog,
  onClose,
}: {
  email: EmailTransmissionRecord;
  catalog: WorkflowCatalogItem[];
  onClose: () => void;
}) {
  const importantFields = [
    ["Workflow", workflowLabel(email.workflowName, catalog) || "-"],
    ["Subject", email.subject || "-"],
    ["Template ID", email.templateId || "-"],
    ["Send type", email.sendType || "-"],
    ["Rule key", email.ruleKey || "-"],
    ["Recipient", email.recipientEmail || "-"],
    ["Sender", email.fromEmail || "-"],
    ["Provider transmission ID", email.providerTransmissionId || "-"],
    ["Provider message ID", email.providerMessageId || "-"],
    ["Candidate ID", email.candidateId || "-"],
    ["Placement ID", email.placementId || "-"],
    ["Client contact ID", email.clientContactId || "-"],
    ["Client corporation ID", email.clientCorporationId || "-"],
    ["Owner email", email.ownerEmail || "-"],
    ["Sent at", formatDateTime(email.sentAt)],
  ];

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <span className="eyebrow">Email Detail</span>
            <h2>{email.subject || "Transmission"}</h2>
          </div>
          <button type="button" className="iconButton" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>

        <div className="detailGrid">
          {importantFields.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <section className="modalSection">
          <h3>Text Body</h3>
          <pre>{email.textBody || "No text body recorded."}</pre>
        </section>

        <section className="modalSection">
          <h3>HTML Body</h3>
          <pre>{email.htmlBody || "No HTML body recorded."}</pre>
        </section>
      </section>
    </div>
  );
}
