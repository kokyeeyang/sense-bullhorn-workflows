"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  Download,
  Filter,
  Mail,
  RefreshCcw,
  Search,
  Send,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  askDashboardAi,
  fetchAiContext,
  fetchDashboardSummary,
  fetchEmailSummary,
  fetchRuns,
  fetchWorkflowCatalog,
  type DashboardQuery,
} from "@/lib/dashboardApi";
import {
  AiMetricsContext,
  CountItem,
  DashboardSummary,
  DashboardTotals,
  EmailSummary,
  RunLog,
  RunsResponse,
  TrendPoint,
  WorkflowCatalogItem,
  WorkflowSummary,
} from "@/lib/types";
import { PaginationControls, paginate } from "@/components/PaginationControls";
import { getDashboardGlossaryEntry } from "@/lib/dashboardGlossary";
import { formatDateTime, formatNumber, getDefaultDateRange, toDateInput } from "@/lib/format";
import { sortWorkflowsByLabel, workflowLabel } from "@/lib/workflowDisplay";

const STATUS_OPTIONS = ["", "success", "failed"];
const CATEGORY_OPTIONS = [
  "",
  "email",
  "survey",
  "placement",
  "candidate",
  "client",
  "compliance",
  "data-enrichment",
];
const ACTION_OPTIONS = [
  "",
  "sent-email",
  "would-send-email",
  "updated",
  "would-update",
  "skipped-missing-owner-email",
  "skipped-rule-filter-mismatch",
];

const SUGGESTED_AI_QUESTIONS = [
  "Summarise workflow health for this period.",
  "Why are records being skipped?",
  "Which workflows need attention?",
];

function getDefaultQuery(): DashboardQuery {
  return {
    ...getDefaultDateRange(7),
    workflowName: "",
    category: "",
    status: "",
    actionDecision: "",
  };
}

function statusClass(status: string | null) {
  if (status === "success") {
    return "statusPill success";
  }
  if (status === "failed") {
    return "statusPill failed";
  }
  return "statusPill neutral";
}

function total(totals: DashboardTotals | undefined, key: keyof DashboardTotals) {
  return Number(totals?.[key] || 0);
}

function MetricCard({
  label,
  value,
  icon,
  tone = "default",
  subLabel,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  subLabel?: string;
}) {
  return (
    <section className={`metricCard ${tone}`}>
      <div className="metricIcon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{formatNumber(value)}</strong>
        {subLabel ? <span>{subLabel}</span> : null}
      </div>
    </section>
  );
}

function MiniTrend({ points, metric }: { points: TrendPoint[]; metric: keyof DashboardTotals }) {
  const max = Math.max(...points.map((point) => total(point.totals, metric)), 1);

  return (
    <div className="miniTrend" aria-label={`${String(metric)} trend`}>
      {points.map((point) => {
        const value = total(point.totals, metric);
        return (
          <div className="trendColumn" key={point.runDate}>
            <span className="trendValue">{formatNumber(value)}</span>
            <div
              className="trendBar"
              style={{ height: `${Math.max(8, (value / max) * 96)}px` }}
              title={`${point.runDate}: ${formatNumber(value)}`}
            />
            <span className="trendDate">{point.runDate.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

function InfoHint({ label, description }: { label: string; description: string }) {
  return (
    <span className="infoHint" tabIndex={0} aria-label={`${label}: ${description}`} data-tooltip={description}>
      i
    </span>
  );
}

function CountList({ items, kind }: { items: CountItem[]; kind: "skipReason" | "actionDecision" }) {
  if (items.length === 0) {
    return <p className="emptyText">No records</p>;
  }

  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <div className="countList">
      {items.map((item) => {
        const glossaryEntry = getDashboardGlossaryEntry(kind, item.key);
        return (
          <div className="countRow" key={item.key}>
            <div>
              <span className="countLabel">
                <span>{glossaryEntry.label}</span>
                <InfoHint label={glossaryEntry.label} description={glossaryEntry.description} />
              </span>
              <strong>{formatNumber(item.count)}</strong>
            </div>
            <div className="countTrack" title={item.key}>
              <span style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowTable({ workflows }: { workflows: WorkflowSummary[] }) {
  return (
    <div className="tableScroller">
      <table>
        <thead>
          <tr>
            <th>Workflow</th>
            <th>Category</th>
            <th>Status</th>
            <th>Runs</th>
            <th>Emails</th>
            <th>Updates</th>
            <th>Skipped</th>
            <th>Last run</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((workflow) => (
            <tr key={workflow.workflowName}>
              <td>
                <strong>{workflow.label || workflow.workflowName}</strong>
                <span>{workflow.description || workflow.workflowName}</span>
              </td>
              <td>{workflow.category}</td>
              <td>
                <span className={statusClass(workflow.lastRunStatus)}>{workflow.lastRunStatus || "none"}</span>
              </td>
              <td>{formatNumber(workflow.totals.totalRuns)}</td>
              <td>{formatNumber(workflow.totals.totalEmailCount)}</td>
              <td>{formatNumber(workflow.totals.updatedCount + workflow.totals.wouldUpdateCount)}</td>
              <td>{formatNumber(workflow.totals.skippedCount + workflow.totals.skippedActionCount)}</td>
              <td>{formatDateTime(workflow.lastRunAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsTable({ runs, catalog }: { runs: RunLog[]; catalog: WorkflowCatalogItem[] }) {
  return (
    <div className="tableScroller compact">
      <table>
        <thead>
          <tr>
            <th>Workflow</th>
            <th>Status</th>
            <th>Trigger</th>
            <th>Finished</th>
            <th>Success</th>
            <th>Failed</th>
            <th>Skipped</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, index) => (
            <tr key={`${run.workflowName}-${run.finishedAt}-${index}`}>
              <td>
                <strong>{workflowLabel(run.workflowName, catalog)}</strong>
                <span>{run.summary || run.workflowName}</span>
              </td>
              <td>
                <span className={statusClass(run.status)}>{run.status}</span>
              </td>
              <td>{run.trigger}</td>
              <td>{formatDateTime(run.finishedAt)}</td>
              <td>{formatNumber(run.successCount)}</td>
              <td>{formatNumber(run.failureCount)}</td>
              <td>{formatNumber(run.skippedCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AiPanel({
  context,
  loading,
  query,
}: {
  context: AiMetricsContext | null;
  loading: boolean;
  query: DashboardQuery;
}) {
  const largestSkip = context?.topSkipReasons?.[0];
  const failedWorkflows =
    context?.workflows.filter((workflow) => workflow.lastRunStatus === "failed").slice(0, 4) || [];
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [checkedSources, setCheckedSources] = useState<string[]>([]);
  const [aiError, setAiError] = useState("");
  const [asking, setAsking] = useState(false);

  async function submitQuestion(nextQuestion = question) {
    const trimmedQuestion = nextQuestion.trim();
    if (!trimmedQuestion || asking) {
      return;
    }

    setQuestion(trimmedQuestion);
    setAnswer("");
    setCheckedSources([]);
    setAiError("");
    setAsking(true);

    try {
      const result = await askDashboardAi(trimmedQuestion, query);
      setAnswer(result.answer);
      setCheckedSources(result.checkedSources || []);
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "AI assistant failed to answer");
    } finally {
      setAsking(false);
    }
  }

  return (
    <aside className="aiPanel">
      <div className="panelHeader">
        <div>
          <span className="eyebrow">OpenAI</span>
          <h2>Metrics Assistant</h2>
        </div>
        <Bot size={20} />
      </div>

      <div className="assistantBox">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about workflow metrics"
          aria-label="Ask about workflow metrics"
          disabled={asking}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void submitQuestion();
            }
          }}
        />
        <button type="button" disabled={!question.trim() || asking} onClick={() => void submitQuestion()}>
          {asking ? "Thinking" : "Ask"}
        </button>
      </div>

      <div className="promptChips" aria-label="Suggested questions">
        {SUGGESTED_AI_QUESTIONS.map((suggestedQuestion) => (
          <button
            type="button"
            key={suggestedQuestion}
            disabled={asking}
            onClick={() => void submitQuestion(suggestedQuestion)}
          >
            {suggestedQuestion}
          </button>
        ))}
      </div>

      {aiError ? <p className="assistantError">{aiError}</p> : null}
      {answer ? (
        <div className="assistantAnswer">
          {answer}
          {checkedSources.length > 0 ? (
            <small>Sources: {checkedSources.join(", ")}</small>
          ) : null}
        </div>
      ) : null}

      {loading ? <p className="emptyText">Loading context</p> : null}

      <div className="insightStack">
        <div className="insight">
          <span>Total runs</span>
          <strong>{formatNumber(context?.totals.totalRuns)}</strong>
        </div>
        <div className="insight">
          <span>Largest skip reason</span>
          <strong>{largestSkip ? largestSkip.key : "None"}</strong>
          {largestSkip ? <small>{formatNumber(largestSkip.count)} records</small> : null}
        </div>
        <div className="insight">
          <span>Failed workflows</span>
          <strong>{formatNumber(failedWorkflows.length)}</strong>
          {failedWorkflows.map((workflow) => (
            <small key={workflow.workflowName}>{workflow.label || workflow.workflowName}</small>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function DashboardClient() {
  const [query, setQuery] = useState<DashboardQuery>(getDefaultQuery);
  const [catalog, setCatalog] = useState<WorkflowCatalogItem[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [emailSummary, setEmailSummary] = useState<EmailSummary | null>(null);
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [aiContext, setAiContext] = useState<AiMetricsContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflowPage, setWorkflowPage] = useState(1);
  const [workflowPageSize, setWorkflowPageSize] = useState(10);
  const [runsPage, setRunsPage] = useState(1);
  const [runsPageSize, setRunsPageSize] = useState(10);

  const workflowOptions = useMemo(
    () => sortWorkflowsByLabel(catalog.filter((workflow) => !query.category || workflow.category === query.category)),
    [catalog, query.category],
  );

  async function loadDashboard(nextQuery = query) {
    setLoading(true);
    setError(null);

    try {
      const [catalogData, summaryData, emailData, runsData, aiData] = await Promise.all([
        fetchWorkflowCatalog(),
        fetchDashboardSummary(nextQuery),
        fetchEmailSummary(nextQuery),
        fetchRuns(nextQuery),
        fetchAiContext(nextQuery),
      ]);

      setCatalog(catalogData);
      setSummary(summaryData);
      setEmailSummary(emailData);
      setRuns(runsData);
      setAiContext(aiData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dashboard data failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  function updateQuery(key: keyof DashboardQuery, value: string) {
    setQuery((current) => ({
      ...current,
      [key]: value,
      ...(key === "category" ? { workflowName: "" } : {}),
    }));
  }

  function applyQuickRange(days: number) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const nextQuery = {
      ...query,
      dateFrom: toDateInput(start),
      dateTo: toDateInput(end),
    };
    setQuery(nextQuery);
    void loadDashboard(nextQuery);
  }

  const totals = summary?.totals;
  const workflowPagination = paginate(summary?.workflows || [], workflowPage, workflowPageSize);
  const runsPagination = paginate(runs?.runs || [], runsPage, runsPageSize);

  return (
    <main className="appShell">
      <section className="dashboardMain">
        <header className="topBar">
          <div>
            <span className="eyebrow">Bullhorn Workflows</span>
            <h1>Workflow Dashboard</h1>
          </div>
          <div className="topActions">
            <button type="button" className="iconButton" onClick={() => void loadDashboard()} title="Refresh">
              <RefreshCcw size={18} />
            </button>
            <button type="button" className="secondaryButton" disabled title="Excel export">
              <Download size={16} />
              Export
            </button>
          </div>
        </header>

        <section className="filterPanel">
          <div className="filterTitle">
            <Filter size={18} />
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
            Category
            <select value={query.category} onChange={(event) => updateQuery("category", event.target.value)}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option || "All"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Workflow
            <select value={query.workflowName} onChange={(event) => updateQuery("workflowName", event.target.value)}>
              <option value="">All</option>
              {workflowOptions.map((workflow) => (
                <option key={workflow.workflowName} value={workflow.workflowName}>
                  {workflow.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={query.status} onChange={(event) => updateQuery("status", event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option || "All"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select
              value={query.actionDecision}
              onChange={(event) => updateQuery("actionDecision", event.target.value)}
            >
              {ACTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option || "All"}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primaryButton" onClick={() => void loadDashboard()}>
            <Search size={16} />
            Apply
          </button>
          <div className="quickRanges">
            <button type="button" onClick={() => applyQuickRange(7)}>
              7D
            </button>
            <button type="button" onClick={() => applyQuickRange(30)}>
              30D
            </button>
          </div>
        </section>

        {error ? (
          <section className="errorBanner">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </section>
        ) : null}

        <section className="metricGrid">
          <MetricCard label="Runs" value={total(totals, "totalRuns")} icon={<Activity size={20} />} />
          <MetricCard
            label="Successful"
            value={total(totals, "successfulRuns")}
            icon={<CheckCircle2 size={20} />}
            tone="good"
          />
          <MetricCard
            label="Failed"
            value={total(totals, "failedRuns")}
            icon={<XCircle size={20} />}
            tone={total(totals, "failedRuns") > 0 ? "bad" : "default"}
          />
          <MetricCard label="Emails" value={total(totals, "totalEmailCount")} icon={<Mail size={20} />} />
          <MetricCard label="Updates" value={total(totals, "updatedCount")} icon={<SlidersHorizontal size={20} />} />
          <MetricCard
            label="Skipped"
            value={total(totals, "skippedCount") + total(totals, "skippedActionCount")}
            icon={<AlertTriangle size={20} />}
            tone="warn"
          />
        </section>

        <section className="contentGrid">
          <section className="panel wide">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Trend</span>
                <h2>Daily Volume</h2>
              </div>
              <BarChart3 size={20} />
            </div>
            <MiniTrend points={summary?.trends || []} metric="comparisonRecordCount" />
          </section>

          <section className="panel">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Email</span>
                <h2>Send Activity</h2>
              </div>
              <Send size={20} />
            </div>
            <div className="stackedStats">
              <div>
                <span>Sent</span>
                <strong>{formatNumber(emailSummary?.totals.sentEmail)}</strong>
              </div>
              <div>
                <span>Would send</span>
                <strong>{formatNumber(emailSummary?.totals.wouldSendEmail)}</strong>
              </div>
              <div>
                <span>Email workflows</span>
                <strong>{formatNumber(emailSummary?.totals.workflowCount)}</strong>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Skipped</span>
                <h2>
                  Top Reasons
                  <InfoHint
                    label="Skipped, Top Reasons"
                    description="Shows the most common reasons records were not processed during workflow runs."
                  />
                </h2>
              </div>
              <AlertTriangle size={20} />
            </div>
            <CountList items={summary?.topSkipReasons || []} kind="skipReason" />
          </section>

          <section className="panel">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Actions</span>
                <h2>
                  Decisions
                  <InfoHint
                    label="Actions, Decisions"
                    description="Shows the outcome decisions recorded by workflows, including updates, email sends, dry-run actions, skips, and failures."
                  />
                </h2>
              </div>
              <SlidersHorizontal size={20} />
            </div>
            <CountList items={summary?.topActionDecisions || []} kind="actionDecision" />
          </section>

          <section className="panel wide">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Workflows</span>
                <h2>Health</h2>
              </div>
              <CalendarDays size={20} />
            </div>
            {loading && !summary ? <p className="emptyText">Loading workflows</p> : null}
            <WorkflowTable workflows={workflowPagination.items} />
            <PaginationControls
              page={workflowPagination.page}
              pageSize={workflowPageSize}
              totalItems={summary?.workflows.length || 0}
              onPageChange={setWorkflowPage}
              onPageSizeChange={(nextPageSize) => {
                setWorkflowPageSize(nextPageSize);
                setWorkflowPage(1);
              }}
            />
          </section>

          <section className="panel wide">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Runs</span>
                <h2>Recent Activity</h2>
              </div>
              <Activity size={20} />
            </div>
            <RunsTable runs={runsPagination.items} catalog={catalog} />
            <PaginationControls
              page={runsPagination.page}
              pageSize={runsPageSize}
              totalItems={runs?.runs.length || 0}
              onPageChange={setRunsPage}
              onPageSizeChange={(nextPageSize) => {
                setRunsPageSize(nextPageSize);
                setRunsPage(1);
              }}
            />
          </section>
        </section>
      </section>

      <AiPanel context={aiContext} loading={loading} query={query} />
    </main>
  );
}
