const {
  BENEFITS_REMINDER_STAGES,
  buildBenefitsReminderTransmission,
  buildDateBeginQueryDatesForStage,
  matchesBenefitsReminderPlacement,
} = require("../src/utils/placementBenefitsReminderUtils");

describe("placementBenefitsReminderUtils", () => {
  test("builds the exact weekday query date for a normal business day", () => {
    expect(
      buildDateBeginQueryDatesForStage({
        businessDateKey: "2026-04-15",
        stage: BENEFITS_REMINDER_STAGES[1],
      }),
    ).toEqual(["2026-03-25"]);
  });

  test("adds Saturday due dates into the Friday query", () => {
    expect(
      buildDateBeginQueryDatesForStage({
        businessDateKey: "2026-04-17",
        stage: BENEFITS_REMINDER_STAGES[1],
      }),
    ).toEqual(["2026-03-27", "2026-03-28"]);
  });

  test("adds Sunday due dates into the Monday query", () => {
    expect(
      buildDateBeginQueryDatesForStage({
        businessDateKey: "2026-04-20",
        stage: BENEFITS_REMINDER_STAGES[1],
      }),
    ).toEqual(["2026-03-30", "2026-03-29"]);
  });

  test("matches an eligible contract placement", () => {
    expect(
      matchesBenefitsReminderPlacement({
        employmentType: "Contract",
        status: "QC Approved",
        candidate: {
          customText21: "Benefit Eligible",
          owner: {
            primaryDepartment: {
              name: "hou - perms",
            },
          },
        },
        clientCorporation: {
          id: 999,
        },
      }),
    ).toBe(true);
  });

  test("rejects excluded departments and client corporations", () => {
    expect(
      matchesBenefitsReminderPlacement({
        employmentType: "Contract",
        status: "approved",
        candidate: {
          customText21: "Benefit Eligible",
          owner: {
            primaryDepartment: {
              name: "hou - dcm",
            },
          },
        },
        clientCorporation: {
          id: 32,
        },
      }),
    ).toBe(false);
  });

  test("builds candidate and cc recipients for follow-up reminders", () => {
    const transmission = buildBenefitsReminderTransmission({
      stage: BENEFITS_REMINDER_STAGES[1],
      templateId: "benefits-day-21",
      placement: {
        id: 123,
        dateBegin: 1774828800000,
        candidate: {
          firstName: "Ava",
          lastName: "Tan",
          email: "ava@example.com",
          owner: {
            email: "candidate.owner@example.com",
          },
        },
        jobOrder: {
          owner: {
            email: "job.owner@example.com",
          },
        },
      },
    });

    expect(transmission.headers).toEqual({
      CC: "job.owner@example.com, candidate.owner@example.com",
    });
    expect(transmission.recipients).toEqual([
      expect.objectContaining({
        address: { email: "ava@example.com" },
      }),
      expect.objectContaining({
        address: { email: "job.owner@example.com", header_to: "ava@example.com" },
      }),
      expect.objectContaining({
        address: { email: "candidate.owner@example.com", header_to: "ava@example.com" },
      }),
    ]);
  });
});
