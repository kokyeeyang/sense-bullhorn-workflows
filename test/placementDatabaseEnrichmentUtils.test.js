const {
  addOneDay,
  buildCandidatePatchFromPlacementForDatabaseEnrichment,
  buildPreviousUtcDayWindow,
  getStatusChangeFromEditHistory,
  isDateOnOrAfterTodayUtc,
  isTargetPlacementDatabaseEnrichmentStatusChange,
} = require("../src/placementDatabaseEnrichmentUtils");

test("builds the previous UTC day window", () => {
  expect(
    buildPreviousUtcDayWindow({
      baseDate: new Date("2026-04-06T00:01:00.000Z"),
      daysBack: 1,
    }),
  ).toEqual({
    startMs: 1775347200000,
    endMs: 1775433600000,
    targetDate: "2026-04-05",
    daysBack: 1,
  });
});

test("matches status changes from qc approved, submitted, or null to approved", () => {
  expect(
    isTargetPlacementDatabaseEnrichmentStatusChange({
      oldValue: "qc approved",
      newValue: "approved",
    }),
  ).toBe(true);
  expect(
    isTargetPlacementDatabaseEnrichmentStatusChange({
      oldValue: "submitted",
      newValue: "approved",
    }),
  ).toBe(true);
  expect(
    isTargetPlacementDatabaseEnrichmentStatusChange({
      oldValue: null,
      newValue: "approved",
    }),
  ).toBe(true);
  expect(
    isTargetPlacementDatabaseEnrichmentStatusChange({
      oldValue: "rejected",
      newValue: "approved",
    }),
  ).toBe(false);
  expect(
    isTargetPlacementDatabaseEnrichmentStatusChange({
      oldValue: "approved",
      newValue: "completed",
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
    buildCandidatePatchFromPlacementForDatabaseEnrichment({
      employmentType: "contract",
      status: "approved",
      payRate: 42.5,
      dateEnd: 1_700_000_000_000,
      candidate: { id: 123 },
      clientCorporation: { name: "Acme Corp" },
      jobOrder: { title: "QA Analyst" },
    }),
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

test("skips the non-perm patch for excluded placement statuses", () => {
  expect(
    buildCandidatePatchFromPlacementForDatabaseEnrichment({
      employmentType: "contract",
      status: "terminated",
      candidate: { id: 123 },
    }),
  ).toBeNull();
});
