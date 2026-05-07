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
