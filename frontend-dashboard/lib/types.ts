export type CountTotalKey =
  | "totalRuns"
  | "successfulRuns"
  | "failedRuns"
  | "successCount"
  | "failureCount"
  | "skippedCount"
  | "comparisonRecordCount"
  | "updatedCount"
  | "wouldUpdateCount"
  | "sentEmailCount"
  | "wouldSendEmailCount"
  | "totalEmailCount"
  | "skippedActionCount"
  | "fieldChangeCount";

export type DashboardTotals = Record<CountTotalKey, number> & {
  workflowCount?: number;
  recordCount?: number;
};

export type CountItem = {
  key: string;
  count: number;
};

export type DashboardFilters = {
  dateFrom: string;
  dateTo: string;
  month: string | null;
  workflowNames: string[];
  category: string | null;
  status: string | null;
  actionDecision: string | null;
  includeRecords: boolean;
  rangeDays: number;
};

export type WorkflowCatalogItem = {
  workflowName: string;
  category: string;
  sendsEmail: boolean;
};

export type WorkflowSummary = {
  workflowName: string;
  category: string;
  sendsEmail: boolean;
  totals: DashboardTotals;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastSummary: string | null;
  artifactPath: string | null;
  topSkipReasons: CountItem[];
  topActionDecisions: CountItem[];
};

export type TrendPoint = {
  runDate: string;
  totals: DashboardTotals;
};

export type DashboardSummary = {
  generatedAt: string;
  environment: string;
  filters: DashboardFilters;
  totals: DashboardTotals;
  workflows: WorkflowSummary[];
  trends: TrendPoint[];
  topSkipReasons: CountItem[];
  topActionDecisions: CountItem[];
  topFieldsChanged: CountItem[];
  topEntityTypes: CountItem[];
};

export type EmailSummary = {
  generatedAt: string;
  environment: string;
  filters: DashboardFilters;
  totals: {
    workflowCount: number;
    totalEmails: number;
    sentEmail: number;
    wouldSendEmail: number;
    skippedActionCount: number;
  };
  workflows: WorkflowSummary[];
  trends: TrendPoint[];
  topSkipReasons: CountItem[];
};

export type RunLog = {
  environment: string;
  workflowName: string;
  runDate: string;
  trigger: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  summary: string;
  artifactPath: string;
};

export type RunsResponse = {
  generatedAt: string;
  environment: string;
  filters: DashboardFilters;
  count: number;
  runs: RunLog[];
};

export type AiMetricsContext = {
  generatedAt: string;
  environment: string;
  filters: Pick<DashboardFilters, "dateFrom" | "dateTo" | "workflowNames" | "category" | "status">;
  totals: DashboardTotals;
  workflows: Array<{
    workflowName: string;
    category: string;
    sendsEmail: boolean;
    totals: DashboardTotals;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    lastSummary: string | null;
    topSkipReasons: CountItem[];
  }>;
  topSkipReasons: CountItem[];
  topActionDecisions: CountItem[];
};

export type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  workflows?: WorkflowCatalogItem[];
  error?: {
    message: string;
  };
};

export type DataMutationRecord = {
  id: number;
  environment: string;
  workflowName: string;
  runDate: string;
  generatedAt: string | null;
  dryRun: boolean;
  action: string;
  entityType: string;
  entityId: number | null;
  relatedEntityType: string;
  relatedEntityId: number | null;
  candidateId: number | null;
  placementId: number | null;
  clientContactId: number | null;
  clientCorporationId: number | null;
  transactionId: string;
  fieldName: string;
  oldValueText: string | null;
  newValueText: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  details: Record<string, unknown>;
  createdAt: string | null;
};

export type DataMutationsResponse = {
  generatedAt: string;
  environment: string;
  filters: DashboardFilters;
  count: number;
  records: DataMutationRecord[];
  storage: string;
};

export type EmailTransmissionRecord = {
  id: number;
  environment: string;
  workflowName: string;
  provider: string;
  sendMethod: string;
  sendType: string;
  ruleKey: string;
  recipientType: string;
  recipientEmail: string;
  recipientFirstName: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  templateId: string;
  providerTransmissionId: string;
  providerMessageId: string;
  placementId: number | null;
  candidateId: number | null;
  clientContactId: number | null;
  clientCorporationId: number | null;
  ownerId: number | null;
  ownerEmail: string;
  surveyKey: string;
  businessDate: string;
  runDate: string;
  sentAt: string | null;
  textBody: string;
  htmlBody: string;
  transmissionPayload: Record<string, unknown>;
  providerResponse: Record<string, unknown>;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string | null;
};

export type EmailTransmissionsResponse = {
  generatedAt: string;
  environment: string;
  filters: DashboardFilters;
  count: number;
  records: EmailTransmissionRecord[];
  storage: string;
};

export type SurveyResponseRecord = {
  partitionKey: string;
  rowKey: string;
  submittedAt: string | null;
  workflowName: string;
  placementId: number | null;
  candidateId: number | null;
  ownerId: number | null;
  ownerEmail: string;
  recipientEmail: string;
  questionId: string;
  questionText: string;
  answer: string;
  issuedAt: string | null;
  surveyKey: string;
  metadata: Record<string, unknown>;
  userAgent: string;
  remoteAddress: string;
  createdAt: string | null;
};

export type SurveyResponsesResponse = {
  generatedAt: string;
  environment: string;
  filters: DashboardFilters;
  count: number;
  records: SurveyResponseRecord[];
  storage: string;
};
