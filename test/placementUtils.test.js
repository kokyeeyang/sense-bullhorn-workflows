const {
  addOneDay,
  buildCandidatePatchFromPlacement,
  getFieldChanges,
  isTargetPlacementStatusChange,
} = require("../src/utils/placementUtils");

test("matches qc approved to approved transition", () => {
  expect(
    isTargetPlacementStatusChange({
      oldValue: "qc approved",
      newValue: "approved",
    }),
  ).toBe(true);
});

test("rejects other transitions", () => {
  expect(
    isTargetPlacementStatusChange({
      oldValue: "submitted",
      newValue: "approved",
    }),
  ).toBe(false);
});

test("adds one day to epoch milliseconds", () => {
  expect(addOneDay(1_700_000_000_000)).toBe(1_700_086_400_000);
});

test("builds candidate patch from placement", () => {
  const result = buildCandidatePatchFromPlacement({
    payRate: 42.5,
    dateEnd: 1_700_000_000_000,
    candidate: { id: 123 },
    clientCorporation: { name: "Acme Corp" },
    jobOrder: { title: "QA Analyst" },
  });

  expect(result).toEqual({
    candidateId: 123,
    patch: {
      companyName: "Acme Corp",
      occupation: "QA Analyst",
      status: "Placed by us",
      hourlyRateLow: 42.5,
      dateAvailable: 1_700_086_400_000,
    },
  });
});

test("computes candidate field changes", () => {
  const changes = getFieldChanges(
    {
      companyName: "Old Corp",
      occupation: "Old Title",
      status: "Available",
      dateAvailable: 1_700_000_000_000,
      hourlyRateLow: 30,
    },
    {
      companyName: "Acme Corp",
      occupation: "QA Analyst",
      status: "Placed by us",
      dateAvailable: 1_700_086_400_000,
      hourlyRateLow: 42.5,
    },
  );

  expect(changes).toEqual([
    { field: "companyName", oldValue: "Old Corp", newValue: "Acme Corp" },
    { field: "occupation", oldValue: "Old Title", newValue: "QA Analyst" },
    { field: "status", oldValue: "Available", newValue: "Placed by us" },
    { field: "dateAvailable", oldValue: 1_700_000_000_000, newValue: 1_700_086_400_000 },
    { field: "hourlyRateLow", oldValue: 30, newValue: 42.5 },
  ]);
});
