const {
  buildTransmission,
  getMatchDetails,
  isApprovedApacStatusChange,
  matchesPlacement,
} = require("../src/utils/approvedPlacementApacUtils");

describe("approvedPlacementApacUtils", () => {
  const placement = {
    id: 123,
    employmentType: "Perm",
    owner: { firstName: "Pat", lastName: "Lee", email: "owner@example.com" },
    candidate: { firstName: "Alex", lastName: "Morgan" },
    jobOrder: {
      clientCorporation: { name: "Acme" },
      owner: { pager: "400", email: "owner@example.com" },
    },
  };

  test("matches approved APAC status transition and perm pager", () => {
    const statusChange = { oldValue: "QC Approved", newValue: "Approved" };
    expect(isApprovedApacStatusChange(statusChange)).toBe(true);
    expect(matchesPlacement({ placement, statusChange })).toBe(true);
    expect(getMatchDetails({ placement, statusChange }).failedChecks).toEqual([]);
  });

  test("builds noreply sender with cc and bcc recipients", () => {
    const payload = buildTransmission({ placement });
    expect(payload.content.from).toEqual({
      name: "Sales Operation Team",
      email: "noreply@spencer-ogden.com",
    });
    expect(payload.content.subject).toBe("Approved placement # 123");
    expect(payload.content.headers).toEqual({
      CC: "apacbilling@spencer-ogden.com",
    });
    expect(payload.recipients.map((recipient) => recipient.address.email)).toEqual([
      "owner@example.com",
      "apacbilling@spencer-ogden.com",
      "magdalena.krasicka@spencer-ogden.com",
    ]);
    expect(payload.content.html).toContain("background-color:#f4f6f8");
  });
});
