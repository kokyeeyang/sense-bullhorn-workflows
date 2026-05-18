const {
  SEND_AT_PACIFIC_HOUR,
  buildTransmission,
  getBusinessDateParts,
  getMatchDetails,
  matchesPlacement,
} = require("../src/utils/payrollNewHireGreetingUtils");

describe("payrollNewHireGreetingUtils", () => {
  test("uses 7am Pacific as the send hour", () => {
    expect(SEND_AT_PACIFIC_HOUR).toBe(7);
    expect(
      getBusinessDateParts({
        baseDate: new Date("2026-05-18T14:15:00.000Z"),
      }),
    ).toEqual({
      dateKey: "2026-05-18",
      hour: 7,
    });
  });

  test("matches US contract placements in the requested statuses", () => {
    const placement = {
      status: "QC Approved",
      employmentType: "Contract",
      candidate: {
        email: "Candidate@Example.com",
        address: { countryName: "United States" },
      },
    };

    expect(matchesPlacement(placement)).toBe(true);
    expect(getMatchDetails({ ...placement, status: "Submitted" })).toMatchObject({
      matched: false,
      failedChecks: ["statusMatches"],
    });
    expect(getMatchDetails({ ...placement, employmentType: "Perm" })).toMatchObject({
      matched: false,
      failedChecks: ["employmentTypeMatches"],
    });
  });

  test("builds the inline payroll greeting transmission", () => {
    const transmission = buildTransmission({
      placement: {
        candidate: {
          firstName: "Sam",
          email: "SAM@example.com",
        },
      },
    });

    expect(transmission.content.from).toEqual({
      name: "Spencer Ogden Payroll Department",
      email: "houseaccounts@spencer-ogden.com",
    });
    expect(transmission.content.subject).toBe(
      "Important information on completing your Spencer Ogden payroll setup",
    );
    expect(transmission.content.html).toContain("Dear Sam,");
    expect(transmission.recipients).toEqual([{ address: { email: "sam@example.com" } }]);
  });
});
