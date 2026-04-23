const {
  addOneDay,
  buildCandidatePatchFromPlacementForDatabaseEnrichment,
  getPlacementDatabaseEnrichmentMatchReason,
  getStatusChangeFromEditHistory,
  isContractPlacementDatabaseEnrichmentStatusChange,
  isContractPlacementFinished,
  isDateBeforeTodayUtc,
  isDateOnOrAfterTodayUtc,
  isPermPlacementDatabaseEnrichmentStatusChange,
  isPlacementDateLastModifiedMatch,
  isPlacementDateLastModifiedStatusEligible,
} = require("../src/placementDatabaseEnrichmentUtils");

test("matches contract status changes from qc approved, submitted, or null to approved", () => {
  expect(
    isContractPlacementDatabaseEnrichmentStatusChange({
      oldValue: "qc approved",
      newValue: "approved",
    }),
  ).toBe(true);
  expect(
    isContractPlacementDatabaseEnrichmentStatusChange({
      oldValue: "submitted",
      newValue: "approved",
    }),
  ).toBe(true);
  expect(
    isContractPlacementDatabaseEnrichmentStatusChange({
      oldValue: null,
      newValue: "approved",
    }),
  ).toBe(true);
  expect(
    isContractPlacementDatabaseEnrichmentStatusChange({
      oldValue: "rejected",
      newValue: "approved",
    }),
  ).toBe(false);
});

test("matches perm status changes only from null to approved", () => {
  expect(
    isPermPlacementDatabaseEnrichmentStatusChange({
      oldValue: null,
      newValue: "approved",
    }),
  ).toBe(true);
  expect(
    isPermPlacementDatabaseEnrichmentStatusChange({
      oldValue: "submitted",
      newValue: "approved",
    }),
  ).toBe(false);
});

test("extracts the status change from placement edit history", () => {
  expect(
    getStatusChangeFromEditHistory({
      fieldChanges: [
        { columnName: "salary", oldValue: "1", newValue: "2" },
        { columnName: "status", oldValue: "submitted", newValue: "approved" },
      ],
    }),
  ).toEqual({
    columnName: "status",
    oldValue: "submitted",
    newValue: "approved",
  });
});

test("extracts the status change when fieldChanges is wrapped in a data array", () => {
  expect(
    getStatusChangeFromEditHistory({
      fieldChanges: {
        total: 2,
        data: [
          { columnName: "salary", oldValue: "1", newValue: "2" },
          { columnName: "status", oldValue: null, newValue: "approved" },
        ],
      },
    }),
  ).toEqual({
    columnName: "status",
    oldValue: null,
    newValue: "approved",
  });
});

test("identifies whether dateBegin is on or after today in UTC", () => {
  const baseDate = new Date("2026-04-06T00:01:00.000Z");

  expect(isDateOnOrAfterTodayUtc("2026-04-06T12:00:00.000Z", { baseDate })).toBe(true);
  expect(isDateOnOrAfterTodayUtc("2026-04-07T00:00:00.000Z", { baseDate })).toBe(true);
  expect(isDateOnOrAfterTodayUtc("2026-04-05T23:59:59.000Z", { baseDate })).toBe(false);
});

test("identifies whether dateEnd is before today in UTC", () => {
  const baseDate = new Date("2026-04-06T00:01:00.000Z");

  expect(isDateBeforeTodayUtc("2026-04-05T23:59:59.000Z", { baseDate })).toBe(true);
  expect(isDateBeforeTodayUtc("2026-04-06T00:00:00.000Z", { baseDate })).toBe(false);
  expect(isDateBeforeTodayUtc("2026-04-07T00:00:00.000Z", { baseDate })).toBe(false);
});

test("identifies finished contract placements by dateEnd", () => {
  const baseDate = new Date("2026-04-06T00:01:00.000Z");

  expect(
    isContractPlacementFinished(
      {
        employmentType: "contract",
        dateEnd: "2026-04-05T00:00:00.000Z",
      },
      { baseDate },
    ),
  ).toBe(true);
  expect(
    isContractPlacementFinished(
      {
        employmentType: "perm",
        dateEnd: "2026-04-05T00:00:00.000Z",
      },
      { baseDate },
    ),
  ).toBe(false);
});

test("matches dateLastModified using the timestamp date", () => {
  const baseDate = new Date("2026-04-13T09:30:00.000Z");

  expect(
    isPlacementDateLastModifiedMatch(
      { dateLastModified: "2026-04-13T05:00:00.000Z" },
      { baseDate },
    ),
  ).toBe(true);
  expect(
    isPlacementDateLastModifiedMatch(
      { dateLastModified: "2026-04-12T23:59:59.000Z" },
      { baseDate },
    ),
  ).toBe(false);
});

test("only allows date-last-modified fallback for approved placements", () => {
  expect(
    isPlacementDateLastModifiedStatusEligible({
      status: "Approved",
    }),
  ).toBe(true);

  expect(
    isPlacementDateLastModifiedStatusEligible({
      status: "Pre-Hire",
    }),
  ).toBe(false);
});

test("returns the correct match reason for perm status changes", () => {
  expect(
    getPlacementDatabaseEnrichmentMatchReason(
      { employmentType: "perm" },
      { oldValue: null, newValue: "approved" },
      { baseDate: new Date("2026-04-13T09:30:00.000Z") },
    ),
  ).toBe("perm-approved-status-change");
});

test("returns the correct match reason for contract status changes", () => {
  expect(
    getPlacementDatabaseEnrichmentMatchReason(
      { employmentType: "contract" },
      { oldValue: "submitted", newValue: "approved" },
      { baseDate: new Date("2026-04-13T09:30:00.000Z") },
    ),
  ).toBe("contract-approved-status-change");
});

test("returns the correct match reason for finished contract placements", () => {
  expect(
    getPlacementDatabaseEnrichmentMatchReason(
      {
        employmentType: "contract",
        dateEnd: "2026-04-05T00:00:00.000Z",
      },
      null,
      { baseDate: new Date("2026-04-06T00:01:00.000Z") },
    ),
  ).toBe("contract-placement-finished");
});

test("returns date-last-modified when status change does not match but the date does", () => {
  expect(
    getPlacementDatabaseEnrichmentMatchReason(
      {
        employmentType: "contract",
        status: "approved",
        dateLastModified: "2026-04-13T05:00:00.000Z",
      },
      { oldValue: "rejected", newValue: "approved" },
      { baseDate: new Date("2026-04-13T09:30:00.000Z") },
    ),
  ).toBe("date-last-modified");
});

test("does not return date-last-modified for pre-hire placements", () => {
  expect(
    getPlacementDatabaseEnrichmentMatchReason(
      {
        employmentType: "contract",
        status: "pre-hire",
        dateLastModified: "2026-04-13T05:00:00.000Z",
      },
      null,
      { baseDate: new Date("2026-04-13T09:30:00.000Z") },
    ),
  ).toBeNull();
});

test("builds the perm enrichment patch when dateBegin is today or later", () => {
  expect(
    buildCandidatePatchFromPlacementForDatabaseEnrichment(
      {
        employmentType: "perm",
        dateBegin: "2026-04-06T00:00:00.000Z",
        candidate: { id: 123 },
        clientCorporation: { name: "Acme Corp" },
        jobOrder: { title: "QA Analyst" },
      },
      { baseDate: new Date("2026-04-06T00:01:00.000Z") },
    ),
  ).toEqual({
    candidateId: 123,
    ruleType: "perm-or-contract-to-perm",
    patch: {
      companyName: "Acme Corp",
      occupation: "QA Analyst",
      status: "Placed by us",
    },
  });
});

test("skips perm enrichment when dateBegin is before today", () => {
  expect(
    buildCandidatePatchFromPlacementForDatabaseEnrichment(
      {
        employmentType: "contract to perm",
        dateBegin: "2026-04-05T00:00:00.000Z",
        candidate: { id: 123 },
      },
      { baseDate: new Date("2026-04-06T00:01:00.000Z") },
    ),
  ).toBeNull();
});

test("builds the non-perm enrichment patch for active placements", () => {
  expect(
    buildCandidatePatchFromPlacementForDatabaseEnrichment(
      {
        employmentType: "contract",
        status: "approved",
        payRate: 42.5,
        dateEnd: 1_700_000_000_000,
        candidate: { id: 123 },
        clientCorporation: { name: "Acme Corp" },
        jobOrder: { title: "QA Analyst" },
      },
      { baseDate: new Date("2023-11-01T00:00:00.000Z") },
    ),
  ).toEqual({
    candidateId: 123,
    ruleType: "non-perm-active-placement",
    patch: {
      companyName: "Acme Corp",
      occupation: "QA Analyst",
      status: "Placed by us",
      hourlyRateLow: 42.5,
      dateAvailable: addOneDay(1_700_000_000_000),
    },
  });
});

test("builds the contract finished patch when candidate is placed", () => {
  expect(
    buildCandidatePatchFromPlacementForDatabaseEnrichment(
      {
        employmentType: "contract",
        dateEnd: "2026-04-05T00:00:00.000Z",
        candidate: {
          id: 123,
          status: "Placed by us",
        },
      },
      { baseDate: new Date("2026-04-06T00:01:00.000Z") },
    ),
  ).toEqual({
    candidateId: 123,
    ruleType: "contract-finished-placement",
    patch: {
      status: "Active",
    },
  });
});

test("skips the contract finished patch when candidate is not placed", () => {
  expect(
    buildCandidatePatchFromPlacementForDatabaseEnrichment(
      {
        employmentType: "contract",
        dateEnd: "2026-04-05T00:00:00.000Z",
        candidate: {
          id: 123,
          status: "Available",
        },
      },
      { baseDate: new Date("2026-04-06T00:01:00.000Z") },
    ),
  ).toBeNull();
});

test("skips the non-perm patch for excluded placement statuses", () => {
  expect(
    buildCandidatePatchFromPlacementForDatabaseEnrichment({
      employmentType: "contract",
      status: "terminated",
      candidate: { id: 123 },
    }),
  ).toBeNull();
});
