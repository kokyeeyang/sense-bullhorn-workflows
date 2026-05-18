const {
  buildCandidateCurrentNpsPatch,
  buildCandidateNpsNoteComments,
  buildRespondedTrackingRecord,
  didPersistToPostgres,
  parseNpsScore,
} = require("../src/workflows/soHowDidWeDoFeedbackResponseHandler");

describe("soHowDidWeDoFeedbackResponseHandler", () => {
  test("parses valid NPS scores from 1 to 10", () => {
    expect(parseNpsScore("1")).toBe(1);
    expect(parseNpsScore("10")).toBe(10);
    expect(parseNpsScore(" 8 ")).toBe(8);
  });

  test("rejects invalid NPS scores", () => {
    expect(parseNpsScore("0")).toBeNull();
    expect(parseNpsScore("11")).toBeNull();
    expect(parseNpsScore("8.5")).toBeNull();
    expect(parseNpsScore("yes")).toBeNull();
    expect(parseNpsScore("")).toBeNull();
  });

  test("builds Bullhorn Current NPS candidate patch", () => {
    expect(buildCandidateCurrentNpsPatch("9")).toEqual({ customFloat1: 9 });
    expect(buildCandidateCurrentNpsPatch("bad")).toBeNull();
  });

  test("builds Bullhorn candidate NPS note comments", () => {
    expect(buildCandidateNpsNoteComments("9")).toBe("NPS Feedback : 9");
    expect(buildCandidateNpsNoteComments("bad")).toBe("");
  });

  test("detects whether the survey response persisted to Postgres", () => {
    expect(didPersistToPostgres({
      results: [
        { target: "azure-table", skipped: false },
        { target: "postgres", skipped: false },
      ],
    })).toBe(true);
    expect(didPersistToPostgres({
      results: [
        { target: "azure-table", skipped: false },
        { target: "postgres", skipped: true },
      ],
    })).toBe(false);
    expect(didPersistToPostgres({ results: [{ target: "azure-table", skipped: false }] })).toBe(false);
  });

  test("builds responded tracking fallback from token payload", () => {
    expect(buildRespondedTrackingRecord({
      payload: {
        trackingPartitionKey: "so-how-did-we-do-feedback-sync|2026-05",
        trackingRowKey: "2026-05-21|survey-123",
        surveyKey: "survey-123",
        candidateId: 2923234,
        recipientEmail: "candidate@example.com",
        issuedAt: "2026-05-18T10:00:00.000Z",
        metadata: {
          ruleKey: "candidate-start-contract",
          recipientType: "candidate",
        },
      },
      answer: "9",
      respondedAt: "2026-05-18T11:00:00.000Z",
    })).toMatchObject({
      partitionKey: "so-how-did-we-do-feedback-sync|2026-05",
      rowKey: "2026-05-21|survey-123",
      workflowName: "so-how-did-we-do-feedback-sync",
      surveyKey: "survey-123",
      ruleKey: "candidate-start-contract",
      recipientType: "candidate",
      recipientEmail: "candidate@example.com",
      candidateId: 2923234,
      responseAnswer: "9",
      trackingStatus: "responded",
      reminderDueDate: "2026-05-21",
    });
  });
});
