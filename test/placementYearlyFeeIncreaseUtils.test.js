const {
  buildPlacementYearlyFeeIncreaseRecipient,
  buildUtcMonthOffsetDayWindow,
  matchesYearlyFeeIncreasePlacement,
} = require("../src/placementYearlyFeeIncreaseUtils");

test("builds an 11-month offset UTC day window", () => {
  expect(
    buildUtcMonthOffsetDayWindow({
      baseDate: new Date("2026-04-07T12:00:00.000Z"),
      monthOffset: 11,
      windowBeforeDays: 0,
      windowAfterDays: 0,
    }),
  ).toEqual({
    startMs: 1746576000000,
    endMs: 1746662400000,
    targetPlacementDateBegin: "2025-05-07",
    monthOffset: 11,
    windowBeforeDays: 0,
    windowAfterDays: 0,
  });
});

test("matches yearly fee increase placements only when all rules pass", () => {
  expect(
    matchesYearlyFeeIncreasePlacement(
      {
        employmentType: "Contract",
        dateEnd: "2026-12-31T00:00:00.000Z",
        clientCorporation: {
          customDate1: "2024-01-01T00:00:00.000Z",
          billingFrequency: "5",
        },
      },
      { baseDate: new Date("2026-04-07T12:00:00.000Z") },
    ),
  ).toBe(true);

  expect(
    matchesYearlyFeeIncreasePlacement(
      {
        employmentType: "Permanent",
        dateEnd: "2026-12-31T00:00:00.000Z",
        clientCorporation: {
          customDate1: "2024-01-01T00:00:00.000Z",
          billingFrequency: "5",
        },
      },
      { baseDate: new Date("2026-04-07T12:00:00.000Z") },
    ),
  ).toBe(false);
});

test("builds the SparkPost recipient payload", () => {
  expect(
    buildPlacementYearlyFeeIncreaseRecipient({
      recipientEmail: "owner@example.com",
      owner: { firstName: "Olivia", lastName: "Stone" },
      placement: {
        id: 49086,
        dateBegin: 1743984000000,
        dateEnd: 1775510400000,
        candidate: { firstName: "Sammy", lastName: "Thackeray" },
        clientCorporation: {
          name: "Bubbles Oil",
          billingFrequency: "5",
          customDate1: 1704067200000,
        },
        jobOrder: {
          title: "Offshore Lead Cables Engineer",
        },
      },
    }),
  ).toEqual({
    address: {
      email: "owner@example.com",
    },
    substitution_data: {
      owner_firstName: "Olivia Stone",
      client_company_name: "Bubbles Oil",
      yearly_fee_increase_percent: "5",
      placement_id: "49086",
      candidate_name: "Sammy Thackeray",
      placement_start_date: "7 April 2025",
      placement_end_date: "6 April 2026",
      job_title: "Offshore Lead Cables Engineer",
      tob_date: "1 January 2024",
    },
  });
});
