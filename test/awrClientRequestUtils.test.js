const {
  buildDateBeginQueryDates,
  buildTransmission,
  getMatchDetails,
  matchesPlacement,
} = require("../src/utils/awrClientRequestUtils");

describe("awrClientRequestUtils", () => {
  const placement = {
    id: 123,
    status: "QC Approved",
    employmentType: "Contract",
    vendorType: "Management Company",
    address: { countryName: "United Kingdom" },
    candidate: { firstName: "Alex", lastName: "Morgan" },
    clientContact: { firstName: "Chris", email: "client@example.com" },
  };

  test("moves weekend due dates to following Monday", () => {
    expect(buildDateBeginQueryDates({ businessDateKey: "2026-05-18", offsetDays: 14 })).toEqual([
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
    ]);
    expect(buildDateBeginQueryDates({ businessDateKey: "2026-05-19", offsetDays: 14 })).toEqual([
      "2026-05-05",
    ]);
  });

  test("matches AWR placement criteria", () => {
    expect(matchesPlacement(placement)).toBe(true);
    expect(getMatchDetails(placement).failedChecks).toEqual([]);
  });

  test("builds EMEA CCS sender with BCC and attachment", () => {
    const payload = buildTransmission({ placement, sendType: "initial" });
    expect(payload.content.from).toEqual({
      name: "Spencer Ogden Compliance",
      email: "emea.ccs@spencer-ogden.com",
    });
    expect(payload.content.headers).toBeUndefined();
    expect(payload.recipients.map((recipient) => recipient.address.email)).toEqual([
      "client@example.com",
      "emeacompliance@spencer-ogden.com",
    ]);
    expect(payload.content.attachments[0]).toEqual(
      expect.objectContaining({
        name: "AWR Client Declaration.pdf",
        type: "application/pdf",
      }),
    );
    expect(payload.content.html).toContain("background-color:#f4f6f8");
  });
});
