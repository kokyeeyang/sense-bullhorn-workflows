const { buildTestSparkPostPayloads } = require("../src/workflows/placementBenefitsReminderTestSend");

describe("placementBenefitsReminderTestSend", () => {
  test("builds three stage payloads using the configured template ids", () => {
    const payloads = buildTestSparkPostPayloads({
      PLACEMENT_BENEFITS_REMINDER_DAY10_SPARKPOST_TEMPLATE_ID: "benefits-day-10",
      PLACEMENT_BENEFITS_REMINDER_DAY21_SPARKPOST_TEMPLATE_ID: "benefits-day-21",
      PLACEMENT_BENEFITS_REMINDER_DAY26_SPARKPOST_TEMPLATE_ID: "benefits-day-26",
    });

    expect(payloads).toHaveLength(6);
    expect(payloads.slice(0, 3).map((item) => item.content.template_id)).toEqual([
      "benefits-day-10",
      "benefits-day-10",
      "benefits-day-21",
    ]);
    expect(payloads[0].recipients).toHaveLength(1);
    expect(payloads[2].recipients).toHaveLength(3);
    expect(payloads[2].content.headers).toEqual({
      CC: "yeeyang.kok+jobowner@spencer-ogden.com, yeeyang.kok+candowner@spencer-ogden.com",
    });
  });
});
