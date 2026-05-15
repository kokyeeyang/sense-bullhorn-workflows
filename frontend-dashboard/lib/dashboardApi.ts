import {
  AiMetricsContext,
  ApiEnvelope,
  DashboardSummary,
  DataMutationsResponse,
  EmailSummary,
  EmailTransmissionsResponse,
  RunsResponse,
  WorkflowCatalogItem,
} from "./types";

export type DashboardQuery = {
  dateFrom: string;
  dateTo: string;
  workflowName: string;
  category: string;
  status: string;
  actionDecision: string;
};

function buildSearchParams(query: Record<string, string>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }

  return params.toString();
}

async function fetchDashboard<T>(path: string, query?: Record<string, string>): Promise<T> {
  const search = query ? buildSearchParams(query) : "";
  const response = await fetch(`/api/dashboard/${path}${search ? `?${search}` : ""}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message || `Dashboard request failed: ${path}`);
  }

  if (path === "workflows") {
    return payload.workflows as T;
  }

  if (!payload.data) {
    throw new Error(`Dashboard response did not include data: ${path}`);
  }

  return payload.data;
}

export async function fetchWorkflowCatalog() {
  return fetchDashboard<WorkflowCatalogItem[]>("workflows");
}

export async function fetchDashboardSummary(query: DashboardQuery) {
  return fetchDashboard<DashboardSummary>("summary", query);
}

export async function fetchEmailSummary(query: DashboardQuery) {
  return fetchDashboard<EmailSummary>("emails", query);
}

export async function fetchRuns(query: DashboardQuery) {
  return fetchDashboard<RunsResponse>("runs", query);
}

export async function fetchAiContext(query: DashboardQuery) {
  return fetchDashboard<AiMetricsContext>("ai-context", query);
}

export async function fetchDataMutations(query: DashboardQuery & Record<string, string>) {
  return fetchDashboard<DataMutationsResponse>("data-mutations", query);
}

export async function fetchEmailTransmissions(query: DashboardQuery & Record<string, string>) {
  return fetchDashboard<EmailTransmissionsResponse>("email-transmissions", query);
}
