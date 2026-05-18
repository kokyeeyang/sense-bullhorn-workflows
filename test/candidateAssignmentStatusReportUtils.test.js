const {
  buildReportRecord,
  getAssignmentCountry,
  getCandidateCountry,
  isLastContactOverdue,
  normalizeFilters,
  placementMatchesCommonFilters,
} = require("../src/utils/candidateAssignmentStatusReportUtils");

describe("candidateAssignmentStatusReportUtils", () => {
  const placement = {
    id: 123,
    status: "Approved",
    employmentType: "Contract",
    candidate: {
      id: 456,
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      status: "Placed by us",
      dateLastComment: "2026-04-01T00:00:00.000Z",
      address: { countryName: "Canada", state: "Alberta" },
    },
    clientCorporation: { id: 789, name: "Acme Energy" },
    jobOrder: {
      id: 111,
      title: "Project Engineer",
      address: { countryName: "United States", state: "Texas" },
      owner: { id: 222, firstName: "Olivia", lastName: "Stone", email: "owner@example.com" },
    },
  };

  test("normalizes report filters and rejects unsupported case types", () => {
    expect(
      normalizeFilters({
        dateFrom: "2026-05-01",
        dateTo: "2026-05-18",
        caseTypes: "terminated-placement,contractor-last-contact-overdue",
        notContactedDays: "45",
      }),
    ).toMatchObject({
      dateFrom: "2026-05-01",
      dateTo: "2026-05-18",
      caseTypes: ["terminated-placement", "contractor-last-contact-overdue"],
      notContactedDays: 45,
    });

    expect(() => normalizeFilters({ caseTypes: "terminated" })).toThrow("Unsupported caseTypes");
  });

  test("uses assignment country separately from candidate country", () => {
    expect(getAssignmentCountry(placement)).toBe("United States");
    expect(getCandidateCountry(placement)).toBe("Canada");
    expect(
      placementMatchesCommonFilters(placement, {
        assignmentCountry: "USA",
        candidateCountry: "Canada",
        employmentType: "contract",
      }),
    ).toBe(true);
  });

  test("detects missing or old last contact", () => {
    expect(
      isLastContactOverdue(placement, {
        notContactedDays: 30,
        baseDate: new Date("2026-05-18T00:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isLastContactOverdue(
        {
          ...placement,
          candidate: { ...placement.candidate, dateLastComment: "2026-05-10T00:00:00.000Z" },
        },
        {
          notContactedDays: 30,
          baseDate: new Date("2026-05-18T00:00:00.000Z"),
        },
      ),
    ).toBe(false);
    expect(isLastContactOverdue({ ...placement, candidate: {} }, { notContactedDays: 30 })).toBe(true);
  });

  test("builds rich candidate and placement report records", () => {
    expect(
      buildReportRecord({
        caseType: "contractor-last-contact-overdue",
        placement,
        notContactedDays: 30,
        baseDate: new Date("2026-05-18T00:00:00.000Z"),
      }),
    ).toMatchObject({
      caseType: "contractor-last-contact-overdue",
      caseLabel: "Contractor Last Contact Overdue",
      candidate: {
        id: 456,
        name: "Jane Doe",
        country: "Canada",
      },
      placement: {
        id: 123,
        assignmentCountry: "United States",
        assignmentState: "Texas",
        clientCorporationName: "Acme Energy",
        ownerName: "Olivia Stone",
      },
      lastContact: {
        field: "dateLastComment",
        daysSinceContact: 47,
        thresholdDays: 30,
      },
    });
  });
});
