const { buildTestSparkPostPayloads } = require("../src/placementBenefitsReminderTestSend");

describe("placementBenefitsReminderTestSend", () => {
  test("builds three stage payloads using the configured template ids", () => {
    const payloads = buildTestSparkPostPayloads({
      PLACEMENT_BENEFITS_REMINDER_DAY10_SPARKPOST_TEMPLATE_ID: "benefits-day-10",
      PLACEMENT_BENEFITS_REMINDER_DAY21_SPARKPOST_TEMPLATE_ID: "benefits-day-21",
      PLACEMENT_BENEFITS_REMINDER_DAY26_SPARKPOST_TEMPLATE_ID: "benefits-day-26",
    });

    expect(payloads).toHaveLength(3);
    expect(payloads.map((item) => item.content.template_id)).toEqual([
      "benefits-day-10",
      "benefits-day-21",
      "benefits-day-26",
    ]);
    expect(payloads[0].recipients).toHaveLength(2);
    expect(payloads[1].recipients).toHaveLength(6);
    expect(payloads[1].content.headers).toEqual({
      CC: "job.owner.test@spencer-ogden.com, candidate.owner.test@spencer-ogden.com",
    });
  });
});
