const {
  buildTestSparkPostPayload,
  getTemplateId,
} = require("../src/interviewIllinoisEmailTestSend");

describe("interviewIllinoisEmailTestSend", () => {
  test("prefers the dedicated Illinois interview template id", () => {
    expect(
      getTemplateId({
        INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID: "interview-illinois-template",
        SPARKPOST_TEMPLATE_ID: "fallback-template",
      }),
    ).toBe("interview-illinois-template");
  });

  test("builds the expected dummy payload for the Illinois interview template", () => {
    expect(
      buildTestSparkPostPayload({
        INTERVIEW_ILLINOIS_SPARKPOST_TEMPLATE_ID: "interview-illinois-template",
      }),
    ).toEqual({
      content: {
        template_id: "interview-illinois-template",
      },
      recipients: [
        {
          address: {
            email: "yeeyang.kok@spencer-ogden.com",
          },
          substitution_data: {
            id: "701",
            candidateReference: {
              name: "Test Candidate",
              id: "516238",
            },
          },
        },
        {
          address: {
            email: "yee_yang94@hotmail.com",
          },
          substitution_data: {
            id: "702",
            candidateReference: {
              name: "Hotmail Candidate",
              id: "516239",
            },
          },
        },
      ],
    });
  });
});
