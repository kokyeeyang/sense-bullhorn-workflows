"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, RefreshCcw, Search } from "lucide-react";
import { fetchSurveyResponses, fetchWorkflowCatalog, type DashboardQuery } from "@/lib/dashboardApi";
import { SurveyResponsesResponse, WorkflowCatalogItem } from "@/lib/types";
import { formatDateTime, formatNumber, getDefaultDateRange } from "@/lib/format";
import { PaginationControls, paginate } from "@/components/PaginationControls";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { sortWorkflowsByLabel, workflowLabel } from "@/lib/workflowDisplay";

const SURVEY_WORKFLOWS = [
  "so-how-did-we-do-feedback-sync",
  "perm-checkin-sync",
  "start-date-approval-reminder-sync",
  "us-contract-performance-checkin-sync",
];

function buildDefaultQuery(): DashboardQuery & Record<string, string> {
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  return {
    ...getDefaultDateRange(30),
    workflowName: params?.get("workflowName") || "",
    category: "",
    status: "",
    actionDecision: "",
    surveyKey: "",
    recipientEmail: "",
    answer: "",
    limit: "100",
  };
}

export function SurveyResponsesPage() {
  const [query, setQuery] = useState(buildDefaultQuery);
  const [catalog, setCatalog] = useState<WorkflowCatalogItem[]>([]);
  const [data, setData] = useState<SurveyResponsesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function load(nextQuery = query) {
    setLoading(true);
    setError(null);

    try {
      const [workflowCatalog, result] = await Promise.all([
        fetchWorkflowCatalog(),
        fetchSurveyResponses(nextQuery),
      ]);
      setCatalog(sortWorkflowsByLabel(workflowCatalog.filter((workflow) => SURVEY_WORKFLOWS.includes(workflow.workflowName))));
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Survey responses failed to load");
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
          <span className="eyebrow">Feedback</span>
          <h1>Survey Responses</h1>
        </div>
        <button type="button" className="iconButton" onClick={() => void load()} title="Refresh">
          <RefreshCcw size={18} />
        </button>
      </header>

      <section className="filterPanel detailFilters">
        <div className="filterTitle">
          <ClipboardCheck size={18} />
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
          Survey key
          <input value={query.surveyKey} onChange={(event) => updateQuery("surveyKey", event.target.value)} placeholder="dummy-survey-1" />
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
          Answer
          <input value={query.answer} onChange={(event) => updateQuery("answer", event.target.value)} placeholder="positive" />
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
            <p>Responses</p>
            {loading && !data ? <LoadingIndicator /> : <strong>{formatNumber(data?.count)}</strong>}
            <span>{data?.storage === "postgres" ? "PostgreSQL survey responses" : "No detail store configured"}</span>
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
            <span className="eyebrow">Responses</span>
            <h2>Submitted Feedback</h2>
          </div>
          {loading ? <LoadingIndicator /> : null}
        </div>
        {loading && !data ? (
          <LoadingIndicator label="Loading survey responses" />
        ) : (
        <div className="tableScroller detailTable">
          <table>
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Workflow</th>
                <th>Survey</th>
                <th>Recipient</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Candidate</th>
                <th>Placement</th>
              </tr>
            </thead>
            <tbody>
              {pagination.items.map((record) => (
                <tr key={`${record.partitionKey}:${record.rowKey}`}>
                  <td>{formatDateTime(record.submittedAt)}</td>
                  <td>
                    <strong>{workflowLabel(record.workflowName, catalog)}</strong>
                    <span>{record.createdAt ? `created ${formatDateTime(record.createdAt)}` : "-"}</span>
                  </td>
                  <td>
                    <strong>{record.surveyKey || "-"}</strong>
                    <span>{record.questionId || "-"}</span>
                  </td>
                  <td>
                    <strong>{record.recipientEmail || "-"}</strong>
                    <span>{record.ownerEmail || "-"}</span>
                  </td>
                  <td className="subjectCell">{record.questionText || "-"}</td>
                  <td>{record.answer || "-"}</td>
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
    </main>
  );
}
