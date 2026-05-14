const { buildEntity } = require("../src/stores/workflowSurveyResponseStore");
const {
  buildWorkflowSurveyToken,
  verifyWorkflowSurveyToken,
} = require("../src/utils/workflowSurveyUtils");

describe("workflowSurveyUtils", () => {
  test("signs and verifies workflow survey tokens", () => {
    const token = buildWorkflowSurveyToken({
      secret: "secret",
      payload: {
        workflowName: "start-date-approval-reminder-sync",
        placementId: 123,
        ownerId: 456,
        ownerEmail: "owner@example.com",
        questionId: "attached-start-date-confirmation",
        questionText:
          "Have you attached your candidates/clients confirmation of start date to your placement?",
        answer: "yes",
        issuedAt: "2026-05-06T00:00:00.000Z",
        metadata: {
          stageKey: "day-2",
        },
      },
    });

    expect(
      verifyWorkflowSurveyToken({
        token,
        secret: "secret",
        expectedAnswer: "yes",
        expectedWorkflow: "start-date-approval-reminder-sync",
      }),
    ).toEqual(
      expect.objectContaining({
        workflowName: "start-date-approval-reminder-sync",
        placementId: 123,
        ownerId: 456,
        ownerEmail: "owner@example.com",
        answer: "yes",
      }),
    );
  });

  test("allows workflow survey tokens without an embedded answer when requested", () => {
    const token = buildWorkflowSurveyToken({
      secret: "secret",
      payload: {
        workflowName: "so-how-did-we-do-feedback-sync",
        placementId: 123,
        questionId: "so-how-did-we-do-nps",
        questionText: "How likely are you to recommend Spencer Ogden to a friend or colleague?",
        surveyKey: "abc123",
      },
    });

    expect(
      verifyWorkflowSurveyToken({
        token,
        secret: "secret",
        expectedWorkflow: "so-how-did-we-do-feedback-sync",
        allowMissingAnswer: true,
      }),
    ).toEqual(
      expect.objectContaining({
        workflowName: "so-how-did-we-do-feedback-sync",
        placementId: 123,
        answer: null,
        surveyKey: "abc123",
      }),
    );
  });

  test("verifies custom allowed survey answers for multiple-choice workflows", () => {
    const token = buildWorkflowSurveyToken({
      secret: "secret",
      payload: {
        workflowName: "vestas-po-sync",
        placementId: 123,
        questionId: "vestas-po-turnaround-time",
        answer: "4-5-days",
      },
    });

    expect(
      verifyWorkflowSurveyToken({
        token,
        secret: "secret",
        expectedWorkflow: "vestas-po-sync",
        expectedAnswer: "4-5-days",
        allowedAnswers: ["0-2-days", "4-5-days", "7-8-days", "2-weeks"],
      }),
    ).toEqual(
      expect.objectContaining({
        workflowName: "vestas-po-sync",
        placementId: 123,
        answer: "4-5-days",
      }),
    );
  });

  test("builds stable survey response entities", () => {
    const entity = buildEntity({
      workflowName: "start-date-approval-reminder-sync",
      placementId: 123,
      candidateId: 789,
      ownerId: 456,
      ownerEmail: "owner@example.com",
      questionId: "attached-start-date-confirmation",
      questionText:
        "Have you attached your candidates/clients confirmation of start date to your placement?",
      answer: "No",
      issuedAt: "2026-05-06T00:00:00.000Z",
      submittedAt: "2026-05-06T00:01:00.000Z",
      metadata: {
        stageKey: "day-10",
      },
    });

    expect(entity).toEqual(
      expect.objectContaining({
        partitionKey: "start-date-approval-reminder-sync",
        workflowName: "start-date-approval-reminder-sync",
        placementId: 123,
        ownerEmail: "owner@example.com",
        answer: "no",
      }),
    );
  });
});
