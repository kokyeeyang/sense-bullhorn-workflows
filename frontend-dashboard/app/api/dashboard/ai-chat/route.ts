import { NextRequest, NextResponse } from "next/server";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DETAIL_LIMITS = {
  runs: 20,
  skipReasons: 30,
  skipWorkflows: 15,
  surveyRateGroups: 20,
  surveyResponses: 80,
  surveyResponseExamples: 12,
};

function getWorkflowApiBaseUrl() {
  const value = process.env.WORKFLOW_API_BASE_URL || "http://localhost:7071/api";
  return value.replace(/\/+$/, "");
}

function buildWorkflowUrl(path: string, searchParams: URLSearchParams) {
  const target = new URL(`${getWorkflowApiBaseUrl()}/${path}`);

  searchParams.forEach((value, key) => {
    if (value) {
      target.searchParams.set(key, value);
    }
  });

  if (process.env.WORKFLOW_API_CODE && !target.searchParams.has("code")) {
    target.searchParams.set("code", process.env.WORKFLOW_API_CODE);
  }

  return target;
}

function sanitizeQuestion(value: unknown) {
  return String(value || "").trim().slice(0, 1200);
}

function buildSearchParams(filters: Record<string, unknown>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    const normalizedValue = String(value || "").trim();
    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  }

  return params;
}

async function fetchDashboardContext(filters: Record<string, unknown>) {
  return fetchDashboardData("dashboard/ai-context", filters);
}

async function fetchDashboardData(path: string, filters: Record<string, unknown>) {
  const response = await fetch(buildWorkflowUrl(path, buildSearchParams(filters)), {
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message || `Dashboard request failed: ${path}`);
  }

  return payload.data;
}

function shouldFetchRuns(question: string) {
  return /\b(run|runs|failed|failure|error|errors|status|health|attention|recent|last)\b/i.test(question);
}

function shouldFetchSkips(question: string) {
  return /\b(skip|skips|skipped|reason|reasons|eligible|eligibility|missing|filter|no status|not found)\b/i.test(
    question,
  );
}

function shouldFetchSurveyRates(question: string) {
  return /\b(survey|surveys|response rate|response rates|responded|responses|nps|feedback|emea|apac|americas)\b/i.test(
    question,
  );
}

function shouldFetchSurveyResponses(question: string) {
  return /\b(sentiment|tone|mood|feel|feeling|positive|negative|neutral|satisfied|dissatisfied|answer|answers|feedback|nps|survey responses?)\b/i.test(
    question,
  );
}

function inferRegionFilter(question: string) {
  if (/\bemea\b/i.test(question)) return "EMEA";
  if (/\bapac\b/i.test(question)) return "APAC";
  if (/\bamericas?\b|\busa?\b|\bunited states\b/i.test(question)) return "Americas";
  return "";
}

function classifySurveyAnswer(answer: unknown) {
  const normalized = String(answer || "").trim().toLowerCase();
  if (!normalized) return "blank";

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    if (numeric >= 9) return "positive";
    if (numeric >= 7) return "neutral";
    return "negative";
  }

  if (/\b(yes|positive|good|great|excellent|satisfied|happy|pass|approved)\b/i.test(normalized)) {
    return "positive";
  }
  if (/\b(no|negative|bad|poor|unhappy|dissatisfied|issue|problem|needs-follow-up|fail|rejected)\b/i.test(normalized)) {
    return "negative";
  }

  return "neutral";
}

function summarizeRuns(data: any) {
  const runs = Array.isArray(data?.runs) ? data.runs : [];
  return {
    countReturnedByApi: Number(data?.count || runs.length || 0),
    includedCount: Math.min(runs.length, DETAIL_LIMITS.runs),
    recentRuns: runs.slice(0, DETAIL_LIMITS.runs).map((run: any) => ({
      workflowName: run.workflowName,
      runDate: run.runDate,
      trigger: run.trigger,
      status: run.status,
      finishedAt: run.finishedAt,
      successCount: run.successCount,
      failureCount: run.failureCount,
      skippedCount: run.skippedCount,
      summary: run.summary,
    })),
  };
}

function summarizeSkips(data: any) {
  const skipReasons = Array.isArray(data?.skipReasons) ? data.skipReasons : [];
  const workflows = Array.isArray(data?.workflows) ? data.workflows : [];

  return {
    totals: data?.totals || null,
    topSkipReasons: skipReasons.slice(0, DETAIL_LIMITS.skipReasons),
    workflowsWithSkips: workflows.slice(0, DETAIL_LIMITS.skipWorkflows).map((workflow: any) => ({
      workflowName: workflow.workflowName,
      label: workflow.label,
      category: workflow.category,
      lastRunAt: workflow.lastRunAt,
      lastRunStatus: workflow.lastRunStatus,
      skippedCount: workflow?.totals?.skippedCount || 0,
      skippedActionCount: workflow?.totals?.skippedActionCount || 0,
      topSkipReasons: workflow.topSkipReasons || [],
    })),
  };
}

function summarizeSurveyRates(data: any) {
  const byWorkflow = Array.isArray(data?.byWorkflow) ? data.byWorkflow : [];
  const byRegion = Array.isArray(data?.byRegion) ? data.byRegion : [];
  const byWorkflowRegion = Array.isArray(data?.byWorkflowRegion) ? data.byWorkflowRegion : [];

  return {
    totals: data?.totals || null,
    byWorkflow: byWorkflow.slice(0, DETAIL_LIMITS.surveyRateGroups),
    byRegion: byRegion.slice(0, DETAIL_LIMITS.surveyRateGroups),
    byWorkflowRegion: byWorkflowRegion.slice(0, DETAIL_LIMITS.surveyRateGroups),
    filters: data?.filters || null,
  };
}

function summarizeSurveyResponses(data: any) {
  const records = Array.isArray(data?.records) ? data.records : [];
  const answerCounts = new Map<string, number>();
  const sentimentCounts = new Map<string, number>();
  const workflowCounts = new Map<string, number>();

  for (const record of records) {
    const answer = String(record?.answer || "blank").trim() || "blank";
    const sentiment = classifySurveyAnswer(answer);
    const workflowName = String(record?.workflowName || "unknown-workflow");
    answerCounts.set(answer, (answerCounts.get(answer) || 0) + 1);
    sentimentCounts.set(sentiment, (sentimentCounts.get(sentiment) || 0) + 1);
    workflowCounts.set(workflowName, (workflowCounts.get(workflowName) || 0) + 1);
  }

  const toSortedItems = (map: Map<string, number>) =>
    Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));

  return {
    countReturnedByApi: Number(data?.count || records.length || 0),
    includedCount: Math.min(records.length, DETAIL_LIMITS.surveyResponses),
    answerCounts: toSortedItems(answerCounts),
    sentimentCounts: toSortedItems(sentimentCounts),
    workflowCounts: toSortedItems(workflowCounts),
    recentResponses: records.slice(0, DETAIL_LIMITS.surveyResponseExamples).map((record: any) => ({
      submittedAt: record.submittedAt,
      workflowName: record.workflowName,
      answer: record.answer,
      inferredSentiment: classifySurveyAnswer(record.answer),
      questionText: record.questionText,
      candidateRegion: record.candidateRegion,
      candidateCountry: record.candidateCountry,
      assignmentRegion: record.assignmentRegion,
      assignmentCountry: record.assignmentCountry,
    })),
    filters: data?.filters || null,
  };
}

async function fetchRelevantDetails(question: string, filters: Record<string, unknown>) {
  const detailContext: Record<string, unknown> = {};
  const checkedSources = ["dashboard/ai-context"];
  const detailPromises: Array<Promise<void>> = [];

  if (shouldFetchRuns(question)) {
    const runFilters = /\b(failed|failure|error|errors)\b/i.test(question) && !filters.status
      ? { ...filters, status: "failed" }
      : filters;
    detailPromises.push(
      fetchDashboardData("dashboard/runs", runFilters).then((data) => {
        detailContext.runs = summarizeRuns(data);
        checkedSources.push("dashboard/runs");
      }),
    );
  }

  if (shouldFetchSkips(question)) {
    detailPromises.push(
      fetchDashboardData("dashboard/skips", filters).then((data) => {
        detailContext.skips = summarizeSkips(data);
        checkedSources.push("dashboard/skips");
      }),
    );
  }

  if (shouldFetchSurveyRates(question)) {
    const region = inferRegionFilter(question);
    const regionKey = /\bcandidates?\b/i.test(question) ? "candidateRegion" : "region";
    const surveyRateFilters = region && !filters.region && !filters[regionKey]
      ? { ...filters, [regionKey]: region }
      : filters;
    detailPromises.push(
      fetchDashboardData("dashboard/survey-rates", surveyRateFilters).then((data) => {
        detailContext.surveyRates = summarizeSurveyRates(data);
        checkedSources.push("dashboard/survey-rates");
      }),
    );
  }

  if (shouldFetchSurveyResponses(question)) {
    const region = inferRegionFilter(question);
    const regionKey = /\bcandidates?\b/i.test(question) ? "candidateRegion" : "region";
    const surveyResponseFilters = {
      ...(region && !filters.region && !filters[regionKey] ? { ...filters, [regionKey]: region } : filters),
      limit: DETAIL_LIMITS.surveyResponses,
    };
    detailPromises.push(
      fetchDashboardData("dashboard/survey-responses", surveyResponseFilters).then((data) => {
        detailContext.surveyResponses = summarizeSurveyResponses(data);
        checkedSources.push("dashboard/survey-responses");
      }),
    );
  }

  await Promise.all(detailPromises);

  return { detailContext, checkedSources };
}

function buildPrompt({
  question,
  context,
  detailContext,
  checkedSources,
}: {
  question: string;
  context: unknown;
  detailContext: Record<string, unknown>;
  checkedSources: string[];
}) {
  return [
    {
      role: "system",
      content:
        "You are a workflow operations analyst for the Spencer Ogden Bullhorn workflow dashboard. " +
        "Use only the supplied dashboard context. Be concise, practical, and explain likely causes in plain English. " +
        "If the data is insufficient, say what extra detail endpoint or filter would be needed.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          question,
          dashboardContext: context,
          detailContext,
          checkedSources,
          detailLimits: DETAIL_LIMITS,
          responseGuidelines: [
            "Lead with the direct answer.",
            "Mention date range and filters when relevant.",
            "Call out failed workflows, largest skip reasons, unusual volumes, and dry-run caveats when useful.",
            "For survey response-rate questions, use detailContext.surveyRates when supplied and compare sent vs responded counts.",
            "For survey sentiment questions, use detailContext.surveyResponses.answerCounts and sentimentCounts based on the answer column. Treat numeric NPS 9-10 as positive, 7-8 as neutral, and 1-6 as negative unless the supplied context says otherwise.",
            "When detailContext is present, use it to support the answer, but do not imply it is a full-table scan.",
            "End with a short 'Checked:' sentence listing the supplied checkedSources.",
            "Do not invent records that are not present in the context.",
          ],
        },
        null,
        2,
      ),
    },
  ];
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: { message: "OPENAI_API_KEY is not configured for the dashboard server." },
      },
      { status: 500 },
    );
  }

  try {
    const body = await request.json();
    const question = sanitizeQuestion(body.question);
    const filters = body.filters && typeof body.filters === "object" ? body.filters : {};

    if (!question) {
      return NextResponse.json(
        {
          success: false,
          error: { message: "Question is required." },
        },
        { status: 400 },
      );
    }

    const context = await fetchDashboardContext(filters);
    const { detailContext, checkedSources } = await fetchRelevantDetails(question, filters);
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: buildPrompt({ question, context, detailContext, checkedSources }),
        temperature: 0.2,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: payload.error?.message || "OpenAI request failed.",
          },
        },
        { status: response.status },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        answer: payload.choices?.[0]?.message?.content || "No answer returned.",
        model,
        contextGeneratedAt: context.generatedAt,
        checkedSources,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : "Dashboard AI chat failed.",
        },
      },
      { status: 500 },
    );
  }
}
