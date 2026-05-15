const {
  buildLastContactQueryDates,
  buildTransmission,
  getMatchDetails,
  matchesPlacement,
} = require("../src/utils/contractorNotContactedReminderUtils");

describe("contractorNotContactedReminderUtils", () => {
  const candidate = {
    id: 123,
    firstName: "Alex",
    lastName: "Morgan",
    dateLastComment: "2026-04-15T00:00:00.000Z",
    customText16: "phone call",
  };
  const placement = {
    id: 456,
    status: "Approved",
    employmentType: "Contract",
    address: { countryName: "United States" },
    candidate,
    jobOrder: {
      owner: {
        firstName: "Pat",
        lastName: "Lee",
        email: "owner@example.com",
        pager: "500",
      },
    },
  };

  test("builds closest Friday or Monday date windows", () => {
    expect(buildLastContactQueryDates({ businessDateKey: "2026-05-15" })).toEqual([
      "2026-04-15",
      "2026-04-16",
    ]);
    expect(buildLastContactQueryDates({ businessDateKey: "2026-05-18" })).toEqual([
      "2026-04-17",
      "2026-04-18",
    ]);
  });

  test("matches approved US contract placements with pager 500", () => {
    const details = getMatchDetails({
      placement,
      candidate,
      dateField: "dateLastComment",
      actionTypeField: "customText16",
    });
    expect(details.failedChecks).toEqual([]);
    expect(matchesPlacement({ placement, candidate, dateField: "dateLastComment", actionTypeField: "customText16" })).toBe(true);
  });

  test("skips sense communication sent action type", () => {
    expect(
      matchesPlacement({
        placement,
        candidate: { ...candidate, customText16: "sense communication sent" },
        dateField: "dateLastComment",
        actionTypeField: "customText16",
      }),
    ).toBe(false);
  });

  test("builds noreply sender payload", () => {
    const payload = buildTransmission({ placement });
    expect(payload.content.from).toEqual({
      name: "Sales Operation Team",
      email: "noreply@spencer-ogden.com",
    });
    expect(payload.recipients).toEqual([{ address: { email: "owner@example.com" } }]);
    expect(payload.content.html).toContain("background-color:#f4f6f8");
  });
});
