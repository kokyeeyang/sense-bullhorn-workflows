"use client";

import { useEffect, useState } from "react";
import { DatabaseZap, RefreshCcw, Search } from "lucide-react";
import { fetchDataMutations, type DashboardQuery } from "@/lib/dashboardApi";
import { DataMutationsResponse } from "@/lib/types";
import { formatDateTime, formatNumber, getDefaultDateRange, stringifyValue } from "@/lib/format";
import { PaginationControls, paginate } from "@/components/PaginationControls";

const DATA_WORKFLOWS = [
  "placement-database-enrichment-sync",
  "candidate-state-sync",
  "placement-status-sync",
  "client-contact-dnc-sync",
  "client-corporation-360-sync",
  "client-corporation-key-account-sync",
];

function buildDefaultQuery(): DashboardQuery & Record<string, string> {
  return {
    ...getDefaultDateRange(30),
    workflowName: "placement-database-enrichment-sync",
    category: "",
    status: "",
    actionDecision: "",
    action: "",
    entityType: "",
    fieldName: "",
    candidateId: "",
    entityId: "",
    limit: "100",
  };
}

function actionClass(action: string) {
  if (action === "updated") {
    return "statusPill success";
  }
  if (action === "failed") {
    return "statusPill failed";
  }
  return "statusPill neutral";
}

export function DataEnrichmentPage() {
  const [query, setQuery] = useState(buildDefaultQuery);
  const [data, setData] = useState<DataMutationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function load(nextQuery = query) {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchDataMutations(nextQuery);
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data enrichment records failed to load");
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

  return (
    <main className="pageShell">
      <header className="topBar">
        <div>
          <span className="eyebrow">Audit Trail</span>
          <h1>Data Enrichment Changes</h1>
        </div>
        <button type="button" className="iconButton" onClick={() => void load()} title="Refresh">
          <RefreshCcw size={18} />
        </button>
      </header>

      <section className="filterPanel detailFilters">
        <div className="filterTitle">
          <DatabaseZap size={18} />
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
            {DATA_WORKFLOWS.map((workflow) => (
              <option key={workflow} value={workflow}>
                {workflow}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select value={query.action} onChange={(event) => updateQuery("action", event.target.value)}>
            <option value="">All</option>
            <option value="would-update">Would update</option>
            <option value="updated">Updated</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label>
          Entity
          <input value={query.entityType} onChange={(event) => updateQuery("entityType", event.target.value)} placeholder="candidate" />
        </label>
        <label>
          Field
          <input value={query.fieldName} onChange={(event) => updateQuery("fieldName", event.target.value)} placeholder="status" />
        </label>
        <label>
          Candidate ID
          <input value={query.candidateId} onChange={(event) => updateQuery("candidateId", event.target.value)} />
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
            <p>Rows</p>
            <strong>{formatNumber(data?.count)}</strong>
            <span>{data?.storage === "postgres" ? "PostgreSQL audit" : "No detail store configured"}</span>
          </div>
        </section>
        <section className="metricCard good">
          <div>
            <p>Updated</p>
            <strong>{formatNumber(records.filter((record) => record.action === "updated").length)}</strong>
          </div>
        </section>
        <section className="metricCard">
          <div>
            <p>Would update</p>
            <strong>{formatNumber(records.filter((record) => record.action === "would-update").length)}</strong>
          </div>
        </section>
      </section>

      <section className="panel fullWidth">
        <div className="panelHeader">
          <div>
            <span className="eyebrow">Changes</span>
            <h2>Old and New Values</h2>
          </div>
          {loading ? <span className="loadingText">Loading</span> : null}
        </div>
        <div className="tableScroller detailTable">
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Candidate</th>
                <th>Placement</th>
                <th>Field</th>
                <th>Old value</th>
                <th>New value</th>
                <th>Reason</th>
                <th>Generated</th>
              </tr>
            </thead>
            <tbody>
              {pagination.items.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.workflowName}</strong>
                    <span>{record.runDate}</span>
                  </td>
                  <td>
                    <span className={actionClass(record.action)}>{record.action}</span>
                  </td>
                  <td>
                    <strong>{record.entityType}</strong>
                    <span>{record.entityId || "-"}</span>
                  </td>
                  <td>{record.candidateId || "-"}</td>
                  <td>{record.placementId || "-"}</td>
                  <td>{record.fieldName || "-"}</td>
                  <td className="valueCell">{stringifyValue(record.oldValueText ?? record.oldValue)}</td>
                  <td className="valueCell">{stringifyValue(record.newValueText ?? record.newValue)}</td>
                  <td>{record.reason || "-"}</td>
                  <td>{formatDateTime(record.generatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
