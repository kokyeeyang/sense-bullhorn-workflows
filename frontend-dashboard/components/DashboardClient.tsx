"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
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
  fetchWorkflowSchedules,
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
  WorkflowScheduleItem,
  WorkflowSchedulesResponse,
  WorkflowSummary,
} from "@/lib/types";
import { PaginationControls, paginate } from "@/components/PaginationControls";
import { LoadingIndicator } from "@/components/LoadingIndicator";
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

const SCHEDULE_REGIONS = ["Americas", "APAC", "EMEA", "Region agnostic"];
const OFFICE_TIME_ZONES = [
  { office: "Denver", region: "Americas", timeZone: "America/Denver" },
  { office: "Chicago", region: "Americas", timeZone: "America/Chicago" },
  { office: "New York", region: "Americas", timeZone: "America/New_York" },
  { office: "London", region: "EMEA", timeZone: "Europe/London" },
  { office: "Perth", region: "APAC", timeZone: "Australia/Perth" },
  { office: "Singapore", region: "APAC", timeZone: "Asia/Singapore" },
  { office: "Kuala Lumpur", region: "APAC", timeZone: "Asia/Kuala_Lumpur" },
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

function formatPacificTime(value: string | null) {
  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatOfficeTime(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatOfficeDate(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function formatUtcOffset(timestamp: number, timeZone: string) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "UTC") || "";
}

function isBusinessHours(timestamp: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return !["Sat", "Sun"].includes(parts.weekday) && hour >= 8 && hour < 18;
}

function formatCountdown(milliseconds: number | null) {
  if (milliseconds === null) {
    return "No countdown";
  }

  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function OfficeTimeStrip({ now }: { now: number }) {
  return (
    <div className="officeTimeStrip" aria-label="Global office local times">
      {OFFICE_TIME_ZONES.map((office) => {
        const open = isBusinessHours(now, office.timeZone);
        return (
          <article className={`officeTimeCard ${open ? "open" : ""}`} key={office.office}>
            <div className="officeTimeTop">
              <strong>{office.office}</strong>
              <span>{office.region}</span>
            </div>
            <div className="officeLocalTime">{formatOfficeTime(now, office.timeZone)}</div>
            <div className="officeTimeMeta">
              <span>{formatOfficeDate(now, office.timeZone)}</span>
              <span>{formatUtcOffset(now, office.timeZone)}</span>
            </div>
            <div className="officePtTime">{formatOfficeTime(now, "America/Los_Angeles")} PT</div>
          </article>
        );
      })}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone = "default",
  subLabel,
  loading = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  subLabel?: string;
  loading?: boolean;
}) {
  return (
    <section className={`metricCard ${tone}`}>
      <div className="metricIcon">{icon}</div>
      <div>
        <p>{label}</p>
        {loading ? <LoadingIndicator /> : <strong>{formatNumber(value)}</strong>}
        {subLabel ? <span>{subLabel}</span> : null}
      </div>
    </section>
  );
}

function MiniTrend({ points, metric, loading = false }: { points: TrendPoint[]; metric: keyof DashboardTotals; loading?: boolean }) {
  if (loading && points.length === 0) {
    return <LoadingIndicator label="Loading trend" />;
  }

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

function CountList({ items, kind, loading = false }: { items: CountItem[]; kind: "skipReason" | "actionDecision"; loading?: boolean }) {
  if (loading && items.length === 0) {
    return <LoadingIndicator label="Loading records" />;
  }

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

function ScheduleBoard({
  schedules,
  generatedAt,
  loading,
}: {
  schedules: WorkflowScheduleItem[];
  generatedAt: string | null;
  loading: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const storedValue = window.localStorage.getItem("workflowScheduleBoardCollapsed");
    if (storedValue) {
      setCollapsed(storedValue === "true");
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("workflowScheduleBoardCollapsed", String(next));
      return next;
    });
  }

  const grouped = useMemo(() => {
    return SCHEDULE_REGIONS.map((region) => ({
      region,
      workflows: schedules
        .filter((schedule) => schedule.region === region)
        .sort((left, right) => String(left.nextRunAt || "9999").localeCompare(String(right.nextRunAt || "9999"))),
    }));
  }, [schedules]);

  return (
    <section className="scheduleBoard">
      <div className="panelHeader">
        <div>
          <span className="eyebrow">Schedules</span>
          <h2>Next Workflow Runs</h2>
        </div>
        <div className="scheduleHeaderMeta">
          <span>Countdowns use Pacific Time (PT)</span>
          <Clock3 size={20} />
          <button
            type="button"
            className="iconButton small"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand schedules" : "Collapse schedules"}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand workflow schedules" : "Collapse workflow schedules"}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {collapsed ? (
        <p className="scheduleCollapsedText">{schedules.length} scheduled workflows hidden</p>
      ) : (
        <>
          {loading && schedules.length === 0 ? <LoadingIndicator label="Loading workflow schedules" /> : null}

          <OfficeTimeStrip now={now} />

          <div className="scheduleGrid">
            {grouped.map(({ region, workflows }) => (
              <section className="regionSchedule" key={region}>
                <div className="regionHeader">
                  <strong>{region}</strong>
                  <span>{workflows.length}</span>
                </div>
                <div className="scheduleList">
                  {workflows.length === 0 ? <p className="emptyText">No scheduled workflows</p> : null}
                  {workflows.map((workflow) => {
                    const nextRunMs = workflow.nextRunAt ? new Date(workflow.nextRunAt).getTime() - now : null;
                    return (
                      <article className="scheduleItem" key={`${workflow.orchestrator}-${workflow.workflowName}`}>
                        <div>
                          <strong>{workflow.label}</strong>
                          <span>{formatPacificTime(workflow.nextRunAt)} PT</span>
                        </div>
                        <div className="countdownBlock">
                          <span className="orchestratorPill">{workflow.orchestrator}</span>
                          <strong>{formatCountdown(nextRunMs)}</strong>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {generatedAt ? <p className="scheduleFootnote">Schedule catalog refreshed {formatDateTime(generatedAt)}</p> : null}
        </>
      )}
    </section>
  );
}

function WorkflowTable({ workflows, loading = false }: { workflows: WorkflowSummary[]; loading?: boolean }) {
  if (loading && workflows.length === 0) {
    return <LoadingIndicator label="Loading workflow health" />;
  }

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

function RunsTable({ runs, catalog, loading = false }: { runs: RunLog[]; catalog: WorkflowCatalogItem[]; loading?: boolean }) {
  if (loading && runs.length === 0) {
    return <LoadingIndicator label="Loading recent activity" />;
  }

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

      {loading ? <LoadingIndicator label="Loading context" /> : null}

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
  const [schedules, setSchedules] = useState<WorkflowSchedulesResponse | null>(null);
  const [aiContext, setAiContext] = useState<AiMetricsContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflowPage, setWorkflowPage] = useState(1);
  const [workflowPageSize, setWorkflowPageSize] = useState(10);
  const [runsPage, setRunsPage] = useState(1);
  const [runsPageSize, setRunsPageSize] = useState(10);

  async function loadSchedulesOnly() {
    try {
      setSchedules(await fetchWorkflowSchedules());
    } catch {
      // Keep the existing schedule catalog visible if a background refresh fails.
    }
  }

  const workflowOptions = useMemo(
    () => sortWorkflowsByLabel(catalog.filter((workflow) => !query.category || workflow.category === query.category)),
    [catalog, query.category],
  );

  async function loadDashboard(nextQuery = query) {
    setLoading(true);
    setError(null);

    try {
      const [catalogData, scheduleData, summaryData, emailData, runsData, aiData] = await Promise.all([
        fetchWorkflowCatalog(),
        fetchWorkflowSchedules(),
        fetchDashboardSummary(nextQuery),
        fetchEmailSummary(nextQuery),
        fetchRuns(nextQuery),
        fetchAiContext(nextQuery),
      ]);

      setCatalog(catalogData);
      setSchedules(scheduleData);
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

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadSchedulesOnly();
    }, 30000);

    return () => window.clearInterval(timer);
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
          <MetricCard label="Runs" value={total(totals, "totalRuns")} icon={<Activity size={20} />} loading={loading && !summary} />
          <MetricCard
            label="Successful"
            value={total(totals, "successfulRuns")}
            icon={<CheckCircle2 size={20} />}
            tone="good"
            loading={loading && !summary}
          />
          <MetricCard
            label="Failed"
            value={total(totals, "failedRuns")}
            icon={<XCircle size={20} />}
            tone={total(totals, "failedRuns") > 0 ? "bad" : "default"}
            loading={loading && !summary}
          />
          <MetricCard label="Emails" value={total(totals, "totalEmailCount")} icon={<Mail size={20} />} loading={loading && !summary} />
          <MetricCard label="Updates" value={total(totals, "updatedCount")} icon={<SlidersHorizontal size={20} />} loading={loading && !summary} />
          <MetricCard
            label="Skipped"
            value={total(totals, "skippedCount") + total(totals, "skippedActionCount")}
            icon={<AlertTriangle size={20} />}
            tone="warn"
            loading={loading && !summary}
          />
        </section>

        <ScheduleBoard
          schedules={schedules?.schedules || []}
          generatedAt={schedules?.generatedAt || null}
          loading={loading}
        />

        <section className="contentGrid">
          <section className="panel wide">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Trend</span>
                <h2>Daily Volume</h2>
              </div>
              {loading && !summary ? <LoadingIndicator /> : <BarChart3 size={20} />}
            </div>
            <MiniTrend points={summary?.trends || []} metric="comparisonRecordCount" loading={loading && !summary} />
          </section>

          <section className="panel">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Email</span>
                <h2>Send Activity</h2>
              </div>
              {loading && !emailSummary ? <LoadingIndicator /> : <Send size={20} />}
            </div>
            <div className="stackedStats">
              <div>
                <span>Sent</span>
                {loading && !emailSummary ? <LoadingIndicator /> : <strong>{formatNumber(emailSummary?.totals.sentEmail)}</strong>}
              </div>
              <div>
                <span>Would send</span>
                {loading && !emailSummary ? <LoadingIndicator /> : <strong>{formatNumber(emailSummary?.totals.wouldSendEmail)}</strong>}
              </div>
              <div>
                <span>Email workflows</span>
                {loading && !emailSummary ? <LoadingIndicator /> : <strong>{formatNumber(emailSummary?.totals.workflowCount)}</strong>}
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
              {loading && !summary ? <LoadingIndicator /> : <AlertTriangle size={20} />}
            </div>
            <CountList items={summary?.topSkipReasons || []} kind="skipReason" loading={loading && !summary} />
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
              {loading && !summary ? <LoadingIndicator /> : <SlidersHorizontal size={20} />}
            </div>
            <CountList items={summary?.topActionDecisions || []} kind="actionDecision" loading={loading && !summary} />
          </section>

          <section className="panel wide">
            <div className="panelHeader">
              <div>
                <span className="eyebrow">Workflows</span>
                <h2>Health</h2>
              </div>
              {loading && !summary ? <LoadingIndicator /> : <CalendarDays size={20} />}
            </div>
            <WorkflowTable workflows={workflowPagination.items} loading={loading && !summary} />
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
              {loading && !runs ? <LoadingIndicator /> : <Activity size={20} />}
            </div>
            <RunsTable runs={runsPagination.items} catalog={catalog} loading={loading && !runs} />
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
