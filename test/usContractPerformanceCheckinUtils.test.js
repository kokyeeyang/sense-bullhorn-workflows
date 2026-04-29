const {
  buildDateBeginQueryDates,
  buildPerformanceCheckinTransmission,
  getPerformanceCheckinMatchDetails,
  matchesPerformanceCheckinPlacement,
  renderHtmlTemplate,
} = require("../src/usContractPerformanceCheckinUtils");

describe("usContractPerformanceCheckinUtils", () => {
  test("queries Friday dateBegin candidates for Saturday check-ins", () => {
    expect(buildDateBeginQueryDates({ businessDateKey: "2026-05-01" })).toEqual([
      "2026-04-03",
      "2026-04-04",
    ]);
  });

  test("queries Monday dateBegin candidates for Sunday check-ins", () => {
    expect(buildDateBeginQueryDates({ businessDateKey: "2026-05-04" })).toEqual([
      "2026-04-06",
      "2026-04-05",
    ]);
  });

  test("matches standard criteria or client corporation override", () => {
    const standardPlacement = {
      id: 1001,
      owner: { pager: "500" },
      dateBegin: Date.UTC(2026, 3, 1),
      employmentType: "Margin Only",
      status: "Approved",
      clientCorporation: { id: 123, customText16: "no" },
    };

    expect(matchesPerformanceCheckinPlacement(standardPlacement)).toBe(true);
    expect(matchesPerformanceCheckinPlacement({
      ...standardPlacement,
      owner: { pager: "100" },
      employmentType: "Permanent",
      status: "Terminated",
      clientCorporation: { id: 142049, customText16: "yes" },
    })).toBe(true);
    expect(matchesPerformanceCheckinPlacement({
      ...standardPlacement,
      clientCorporation: { id: 142049, customText16: "no" },
    })).toBe(false);
  });

  test("explains failed eligibility checks", () => {
    const details = getPerformanceCheckinMatchDetails({
      id: 1001,
      owner: { pager: "100" },
      dateBegin: Date.UTC(2026, 3, 1),
      employmentType: "Permanent",
      status: "Submitted",
      clientCorporation: { id: 142049, name: "Excluded", customText16: "no" },
    });

    expect(details.matched).toBe(false);
    expect(details.failedStandardChecks).toEqual([
      "ownerPagerIs500",
      "employmentTypeAllowed",
      "clientCorporationAllowed",
      "statusAllowed",
    ]);
    expect(details.values).toMatchObject({
      ownerPager: "100",
      employmentType: "Permanent",
      status: "Submitted",
      clientCorporationId: 142049,
      clientCorporationCustomText16: "no",
    });
  });

  test("shows client corporation override in eligibility details", () => {
    const details = getPerformanceCheckinMatchDetails({
      id: 1001,
      owner: { pager: "100" },
      dateBegin: Date.UTC(2026, 3, 1),
      employmentType: "Permanent",
      status: "Submitted",
      clientCorporation: { id: 142049, customText16: "yes" },
    });

    expect(details.matched).toBe(true);
    expect(details.clientCorporationOverride).toBe(true);
    expect(details.standardCriteria).toBe(false);
  });

  test("builds inline SparkPost payload with cc and owner sender", () => {
    const payload = buildPerformanceCheckinTransmission({
      placement: {
        id: 1001,
        dateBegin: Date.UTC(2026, 3, 1),
        candidate: { firstName: "Ava", lastName: "Tan" },
        clientContact: { firstName: "Maya", email: "maya@example.com" },
        jobOrder: {
          owner: {
            firstName: "Jordan",
            lastName: "Reed",
            email: "jordan@example.com",
            reportToPerson: { email: "manager@example.com" },
          },
        },
      },
    });

    expect(payload.content.from).toEqual({
      email: "jordan@example.com",
      name: "Jordan Reed",
    });
    expect(payload.content.subject).toBe("Ava Tan's Performance Check-in: Your Feedback Needed");
    expect(payload.content.headers).toEqual({ CC: "manager@example.com" });
    expect(payload.recipients).toEqual([
      { address: { email: "maya@example.com" } },
      { address: { email: "manager@example.com", header_to: "maya@example.com" } },
    ]);
  });

  test("renders the standalone HTML template with escaped values", () => {
    const html = renderHtmlTemplate({
      client_first_name: "Maya",
      candidate_name: "Ava & Co",
      date_begin: "1 April 2026",
      job_order_owner_name: "Jordan <Reed>",
    });

    expect(html).toContain("Hi Maya");
    expect(html).toContain("Ava &amp; Co");
    expect(html).toContain("Jordan &lt;Reed&gt;");
    expect(html).not.toContain("{{candidate_name}}");
  });
});
