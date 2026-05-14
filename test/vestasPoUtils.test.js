const {
  DEFAULT_CC_EMAILS,
  SURVEY_OPTIONS,
  buildDateAddedQueryDates,
  buildEmailContent,
  buildTransmission,
  getBusinessDateParts,
  getMatchDetails,
  matchesPlacement,
} = require("../src/utils/vestasPoUtils");

describe("vestasPoUtils", () => {
  const placement = {
    id: 12345,
    dateAdded: "2026-05-14T10:00:00.000Z",
    dateBegin: "2026-06-01T00:00:00.000Z",
    salary: 125000,
    flatFee: 37500,
    owner: {
      id: 99,
      firstName: "Mindy",
      lastName: "Prefling",
      email: "owner@example.com",
    },
    candidate: {
      id: 456,
      firstName: "Alex",
      lastName: "Morgan",
    },
    clientCorporation: {
      id: 10752,
      name: "Vestas",
    },
    clientContact: {
      id: 789,
      firstName: "Chris",
      lastName: "Jones",
      email: "client@example.com",
    },
    jobOrder: {
      id: 333,
      title: "Project Manager",
    },
  };

  test("matches only Vestas placements by client corporation id", () => {
    expect(matchesPlacement(placement)).toBe(true);
    expect(getMatchDetails(placement).matched).toBe(true);
    expect(
      matchesPlacement({
        ...placement,
        clientCorporation: {
          id: 1,
          name: "Other",
        },
      }),
    ).toBe(false);
  });

  test("builds Monday dateAdded query dates for weekend catch-up", () => {
    expect(buildDateAddedQueryDates({ businessDateKey: "2026-05-18" })).toEqual([
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
    ]);
    expect(buildDateAddedQueryDates({ businessDateKey: "2026-05-19" })).toEqual([
      "2026-05-19",
    ]);
    expect(buildDateAddedQueryDates({ businessDateKey: "2026-05-17" })).toEqual([]);
  });

  test("reads Pacific business date parts", () => {
    expect(
      getBusinessDateParts({
        baseDate: new Date("2026-05-14T13:00:00.000Z"),
      }),
    ).toEqual({
      dateKey: "2026-05-14",
      dayOfWeek: 4,
      hour: 6,
    });
  });

  test("builds themed email content with survey buttons", () => {
    const content = buildEmailContent({
      placement,
      config: {
        WORKFLOW_SURVEY_RESPONSE_BASE_URL: "https://example.com/api/workflows/vestas-po/respond",
        WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET: "secret",
      },
    });

    expect(content.from).toEqual({
      name: "Spencer Ogden",
      email: "houseaccounts@spencer-ogden.com",
    });
    expect(content.subject).toBe("Purchase Order Request - Placement 12345 - Alex Morgan");
    expect(content.html).toContain("<!doctype html>");
    expect(content.html).toContain("background-color:#f4f6f8");
    expect(content.html).toContain("max-width:680px");
    expect(content.html).toContain("Please confirm the turnaround time for the purchase order");
    for (const option of SURVEY_OPTIONS) {
      expect(content.html).toContain(option.label);
    }
    expect(content.text).toContain("Compensation: $ 125,000");
    expect(content.text).toContain("Fee: $ 37,500");
  });

  test("builds recipients with fixed cc recipients and attachment", () => {
    const transmission = buildTransmission({
      placement,
      config: {
        WORKFLOW_SURVEY_RESPONSE_BASE_URL: "https://example.com/api/workflows/vestas-po/respond",
        WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET: "secret",
      },
    });

    expect(transmission.recipientEnvelope).toEqual({
      toEmail: "owner@example.com",
      ccEmails: DEFAULT_CC_EMAILS,
      missingOwnerEmail: false,
    });
    expect(transmission.recipients.map((recipient) => recipient.address.email)).toEqual([
      "owner@example.com",
      ...DEFAULT_CC_EMAILS,
    ]);
    expect(transmission.content.headers.CC).toBe(DEFAULT_CC_EMAILS.join(", "));
    expect(transmission.content.attachments[0]).toEqual(
      expect.objectContaining({
        name: "Vestas TOB.pdf",
        type: "application/pdf",
      }),
    );
  });
});
