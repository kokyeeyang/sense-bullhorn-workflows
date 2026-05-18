const {
  buildQueryPlan,
  buildTransmission,
  getMatchDetails,
  matchesPlacement,
} = require("../src/utils/placementEndDateReminderUtils");

describe("placementEndDateReminderUtils", () => {
  test("moves weekend send dates to the closest Friday or Monday", () => {
    expect(buildQueryPlan({ businessDateKey: "2026-05-15" })).toEqual([
      {
        stageKey: "day90",
        stageLabel: "90 day",
        dayOffset: 90,
        dateEndDates: ["2026-08-13", "2026-08-14"],
      },
      {
        stageKey: "day60",
        stageLabel: "60 day",
        dayOffset: 60,
        dateEndDates: ["2026-07-14", "2026-07-15"],
      },
    ]);

    expect(buildQueryPlan({ businessDateKey: "2026-05-18" })[0].dateEndDates).toEqual([
      "2026-08-15",
      "2026-08-16",
    ]);
    expect(buildQueryPlan({ businessDateKey: "2026-05-16" })[0].dateEndDates).toEqual([]);
  });

  test("matches active contract or margin only placements ending on or after today", () => {
    const placement = {
      status: "Approved",
      employmentType: "Margin Only",
      dateEnd: Date.UTC(2026, 7, 16),
      jobOrder: {
        owner: { email: "owner@example.com" },
      },
    };

    expect(matchesPlacement(placement, { businessDateKey: "2026-05-18" })).toBe(true);
    expect(
      getMatchDetails({ ...placement, status: "Pre-Hire" }, { businessDateKey: "2026-05-18" }),
    ).toMatchObject({
      matched: false,
      failedChecks: ["statusAllowed"],
    });
    expect(
      getMatchDetails({ ...placement, dateEnd: Date.UTC(2026, 4, 17) }, { businessDateKey: "2026-05-18" }),
    ).toMatchObject({
      matched: false,
      failedChecks: ["dateEndOnOrAfterBusinessDate"],
    });
  });

  test("builds recipients, subject, and themed body", () => {
    const transmission = buildTransmission({
      stage: { key: "day90", label: "90 day", dayOffset: 90 },
      placement: {
        id: 123,
        dateEnd: Date.UTC(2026, 7, 16),
        candidate: { firstName: "Jane", lastName: "Doe" },
        clientCorporation: { name: "Acme Energy" },
        clientContact: { firstName: "Chris", lastName: "Client", companyName: "Acme Energy" },
        jobOrder: {
          owner: {
            firstName: "Olivia",
            email: "OWNER@example.com",
            reportToPerson: { email: "MANAGER@example.com" },
          },
          assignedUser: { email: "ASSIGNED@example.com" },
        },
      },
    });

    expect(transmission.content.subject).toBe("90 day Placement End Date Reminder 123 - Jane Doe");
    expect(transmission.content.headers).toEqual({ CC: "manager@example.com" });
    expect(transmission.recipientEnvelope).toEqual({
      toEmail: "owner@example.com",
      ccEmails: ["manager@example.com"],
      bccEmails: ["assigned@example.com"],
      missingToEmail: false,
    });
    expect(transmission.content.html).toContain("Hi Olivia,");
    expect(transmission.content.html).toContain("currently working at Acme Energy");
  });
});
