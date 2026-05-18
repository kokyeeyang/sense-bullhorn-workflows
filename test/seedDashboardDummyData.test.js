const {
  buildDummyTransmission,
  buildSurveyResponses,
  buildSurveyTrackingRows,
} = require("../src/workflows/seedDashboardDummyData");

describe("seedDashboardDummyData", () => {
  test("marks dummy email transmissions with send_type dummy", () => {
    const transmission = buildDummyTransmission({
      workflowName: "placement-end-date-reminder-sync",
      index: 0,
      baseDate: new Date("2026-05-18T00:00:00.000Z"),
      environment: "production",
    });

    expect(transmission.audit).toMatchObject({
      workflowName: "placement-end-date-reminder-sync",
      sendType: "dummy",
      recipientType: "jobOrderOwner",
    });
    expect(transmission.payload.content.subject).toContain("[Dummy]");
    expect(transmission.payload.recipients[0].address.email).toContain("demo.spencer-ogden.example");
    expect(transmission.audit.metadata).toMatchObject({ dummy: true });
  });

  test("builds survey tracking rows and responses with dummy metadata", () => {
    const baseDate = new Date("2026-05-18T00:00:00.000Z");
    const trackingRows = buildSurveyTrackingRows({ baseDate });
    const responses = buildSurveyResponses({ baseDate });

    expect(trackingRows).toHaveLength(6);
    expect(trackingRows.every((row) => row.sendType === "dummy")).toBe(true);
    expect(trackingRows.every((row) => row.metadata.dummy === true)).toBe(true);
    expect(responses).toHaveLength(4);
    expect(responses.every((response) => response.metadata.dummy === true)).toBe(true);
  });
});
