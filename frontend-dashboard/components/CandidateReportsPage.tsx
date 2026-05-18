"use client";

import { useMemo, useState } from "react";
import { Download, FileSearch, RefreshCcw, Search } from "lucide-react";
import { fetchCandidateAssignmentStatusReport } from "@/lib/dashboardApi";
import {
  CandidateAssignmentCaseType,
  CandidateAssignmentStatusRecord,
  CandidateAssignmentStatusResponse,
} from "@/lib/types";
import { formatDateTime, formatNumber, getDefaultDateRange } from "@/lib/format";
import { PaginationControls, paginate } from "@/components/PaginationControls";

const CASE_TYPE_OPTIONS: Array<{ value: CandidateAssignmentCaseType; label: string }> = [
  { value: "terminated-placement", label: "Terminated Placements" },
  { value: "completed-contract-assignment", label: "Completed Contract Assignments" },
  { value: "contractor-last-contact-overdue", label: "Contractors Not Contacted" },
];

function buildDefaultQuery(): Record<string, string> {
  return {
    ...getDefaultDateRange(30),
    caseTypes: CASE_TYPE_OPTIONS.map((option) => option.value).join(","),
    assignmentCountry: "",
    candidateCountry: "",
    employmentType: "",
    notContactedDays: "30",
    limit: "500",
  };
}

function escapeCsvValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toDateValue(value: string | number | null) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
}

function buildCsv(records: CandidateAssignmentStatusRecord[]) {
  const headers = [
    "Case Type",
    "Candidate ID",
    "Candidate Name",
    "Candidate Email",
    "Candidate Status",
    "Candidate Country",
    "Candidate State",
    "Placement ID",
    "Placement Status",
    "Employment Type",
    "Assignment Country",
    "Assignment State",
    "Client",
    "Job Title",
    "Owner Name",
    "Owner Email",
    "Date Begin",
    "Date End",
    "Last Contact",
    "Days Since Contact",
  ];
  const rows = records.map((record) => [
    record.caseLabel,
    record.candidate.id,
    record.candidate.name,
    record.candidate.email,
    record.candidate.status,
    record.candidate.country,
    record.candidate.state,
    record.placement.id,
    record.placement.status,
    record.placement.employmentType,
    record.placement.assignmentCountry,
    record.placement.assignmentState,
    record.placement.clientCorporationName,
    record.placement.jobTitle,
    record.placement.ownerName,
    record.placement.ownerEmail,
    toDateValue(record.placement.dateBegin),
    toDateValue(record.placement.dateEnd),
    record.lastContact.value ? toDateValue(record.lastContact.value) : "",
    record.lastContact.daysSinceContact ?? "",
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvValue).join(",")).join("\n");
}

function downloadCsv(records: CandidateAssignmentStatusRecord[]) {
  const blob = new Blob([buildCsv(records)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `candidate-assignment-status-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function caseTypeClass(caseType: string) {
  if (caseType === "terminated-placement") return "statusPill failed";
  if (caseType === "completed-contract-assignment") return "statusPill success";
  return "statusPill neutral";
}

export function CandidateReportsPage() {
  const [query, setQuery] = useState(buildDefaultQuery);
  const [data, setData] = useState<CandidateAssignmentStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function load(nextQuery = query) {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchCandidateAssignmentStatusReport(nextQuery);
      setData(result);
      setPage(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Candidate report failed to load");
    } finally {
      setLoading(false);
    }
  }

  function updateQuery(key: string, value: string) {
    setQuery((current) => ({ ...current, [key]: value }));
  }

  function toggleCaseType(caseType: CandidateAssignmentCaseType) {
    const current = new Set(query.caseTypes.split(",").filter(Boolean));
    if (current.has(caseType)) {
      current.delete(caseType);
    } else {
      current.add(caseType);
    }
    updateQuery("caseTypes", Array.from(current).join(","));
  }

  const records = data?.records || [];
  const pagination = paginate(records, page, pageSize);
  const selectedCaseTypes = useMemo(() => new Set(query.caseTypes.split(",").filter(Boolean)), [query.caseTypes]);

  return (
    <main className="pageShell">
      <header className="topBar">
        <div>
          <span className="eyebrow">Bullhorn Reports</span>
          <h1>Candidate Assignment Status</h1>
        </div>
        <div className="topActions">
          <button type="button" className="iconButton" onClick={() => void load()} title="Refresh">
            <RefreshCcw size={18} />
          </button>
          <button
            type="button"
            className="secondaryButton"
            disabled={records.length === 0}
            onClick={() => downloadCsv(records)}
            title="Export CSV"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </header>

      <section className="filterPanel detailFilters reportFilters">
        <div className="filterTitle">
          <FileSearch size={18} />
          <span>Filters</span>
        </div>
        <label>
          Placement Start
          <input type="date" value={query.dateFrom} onChange={(event) => updateQuery("dateFrom", event.target.value)} />
        </label>
        <label>
          Placement End
          <input type="date" value={query.dateTo} onChange={(event) => updateQuery("dateTo", event.target.value)} />
        </label>
        <label>
          Assignment Country
          <input
            value={query.assignmentCountry}
            onChange={(event) => updateQuery("assignmentCountry", event.target.value)}
            placeholder="United States"
          />
        </label>
        <label>
          Candidate Country
          <input
            value={query.candidateCountry}
            onChange={(event) => updateQuery("candidateCountry", event.target.value)}
            placeholder="Canada"
          />
        </label>
        <label>
          Employment Type
          <input
            value={query.employmentType}
            onChange={(event) => updateQuery("employmentType", event.target.value)}
            placeholder="contract"
          />
        </label>
        <label>
          Not Contacted Days
          <input
            type="number"
            min="1"
            value={query.notContactedDays}
            onChange={(event) => updateQuery("notContactedDays", event.target.value)}
          />
        </label>
        <label>
          Limit
          <input type="number" min="1" value={query.limit} onChange={(event) => updateQuery("limit", event.target.value)} />
        </label>
        <button type="button" className="primaryButton" onClick={() => void load()}>
          <Search size={16} />
          Search
        </button>
        <div className="caseTypeToggles">
          {CASE_TYPE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selectedCaseTypes.has(option.value)}
                onChange={() => toggleCaseType(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="filterHelpText">
          Terminated placements use status-change date, completed assignments use placement end date, and contractors not contacted uses approved contract placements active during the selected period plus the last-contact threshold.
        </p>
      </section>

      {error ? <section className="errorBanner">{error}</section> : null}

      <section className="metricGrid detailMetricGrid">
        <section className="metricCard">
          <div>
            <p>Rows</p>
            <strong>{formatNumber(data?.count)}</strong>
            <span>Live Bullhorn report</span>
          </div>
        </section>
        <section className="metricCard">
          <div>
            <p>Assignment Countries</p>
            <strong>{formatNumber(new Set(records.map((record) => record.placement.assignmentCountry).filter(Boolean)).size)}</strong>
          </div>
        </section>
        <section className="metricCard">
          <div>
            <p>Candidate Countries</p>
            <strong>{formatNumber(new Set(records.map((record) => record.candidate.country).filter(Boolean)).size)}</strong>
          </div>
        </section>
      </section>

      <section className="panel fullWidth">
        <div className="panelHeader">
          <div>
            <span className="eyebrow">Results</span>
            <h2>Candidate and Placement Details</h2>
          </div>
          {loading ? <span className="loadingText">Loading</span> : null}
        </div>
        <div className="tableScroller detailTable">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Candidate</th>
                <th>Email</th>
                <th>Candidate Country</th>
                <th>Assignment Country</th>
                <th>Placement Status</th>
                <th>Employment</th>
                <th>Client</th>
                <th>Owner</th>
                <th>Start</th>
                <th>End</th>
                <th>Last Contact</th>
              </tr>
            </thead>
            <tbody>
              {pagination.items.map((record, index) => (
                <tr key={`${record.caseType}:${record.placement.id}:${record.candidate.id}:${index}`}>
                  <td>
                    <span className={caseTypeClass(record.caseType)}>{record.caseLabel}</span>
                  </td>
                  <td>
                    <strong>{record.candidate.name || "-"}</strong>
                    <span>{record.candidate.id || "-"}</span>
                  </td>
                  <td>{record.candidate.email || "-"}</td>
                  <td>
                    <strong>{record.candidate.country || "-"}</strong>
                    <span>{record.candidate.state || "-"}</span>
                  </td>
                  <td>
                    <strong>{record.placement.assignmentCountry || "-"}</strong>
                    <span>{record.placement.assignmentState || "-"}</span>
                  </td>
                  <td>{record.placement.status || "-"}</td>
                  <td>{record.placement.employmentType || "-"}</td>
                  <td>
                    <strong>{record.placement.clientCorporationName || "-"}</strong>
                    <span>{record.placement.jobTitle || "-"}</span>
                  </td>
                  <td>
                    <strong>{record.placement.ownerName || "-"}</strong>
                    <span>{record.placement.ownerEmail || "-"}</span>
                  </td>
                  <td>{formatDateTime(toDateValue(record.placement.dateBegin) || null)}</td>
                  <td>{formatDateTime(toDateValue(record.placement.dateEnd) || null)}</td>
                  <td>
                    <strong>{record.lastContact.value ? formatDateTime(record.lastContact.value) : "Never"}</strong>
                    <span>
                      {record.lastContact.daysSinceContact === null
                        ? `Threshold ${record.lastContact.thresholdDays} days`
                        : `${record.lastContact.daysSinceContact} days ago`}
                    </span>
                  </td>
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
