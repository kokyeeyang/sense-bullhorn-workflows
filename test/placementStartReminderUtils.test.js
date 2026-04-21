const {
  buildFullAddress,
  buildFullName,
  buildSparkPostRecipient,
  formatDateBegin,
} = require("../src/placementStartReminderUtils");

describe("placementStartReminderUtils", () => {
  test("formats names, addresses, and SparkPost substitution data", () => {
    expect(buildFullName({ firstName: "Jane", lastName: "Doe" })).toBe("Jane Doe");
    expect(
      buildFullAddress({
        address1: "1 Main St",
        address2: "",
        city: "Houston",
        state: "TX",
        zip: "77001",
        countryName: "United States",
      }),
    ).toBe("1 Main St, Houston, TX, 77001, United States");
    expect(formatDateBegin(1774828800000)).toBe("30 March 2026");

    expect(
      buildSparkPostRecipient({
        recipientEmail: "owner@example.com",
        placement: {
          id: 49086,
          dateBegin: 1774828800000,
          customText8: "Yes",
          customText18: "PO-123",
          customText60: "SO Italy",
          candidate: { firstName: "Sammy", lastName: "Thackeray" },
          clientCorporation: {
            name: "Bubbles Oil",
            customText2: "Agreed",
            customText10: "Yes",
            customText11: "Spencer Ogden Ltd",
          },
          billingClientContact: {
            firstName: "Janet",
            lastName: "Mills",
            customText3: "FIN-001",
            address: {
              address1: "1 Main St",
              city: "Houston",
              state: "TX",
              zip: "77001",
              countryName: "United States",
            },
          },
          jobOrder: {
            id: 123,
            owner: { firstName: "Olivia", lastName: "Stone" },
          },
        },
      }),
    ).toEqual({
      address: {
        email: "owner@example.com",
      },
      substitution_data: {
        placement_id: "49086",
        jobOrderOwner_firstName: "Olivia",
        candidate_name: "Sammy Thackeray",
        client_company_name: "Bubbles Oil",
        date_begin: "30 March 2026",
        so_entity: "SO Italy",
        legal_entity_name: "Spencer Ogden Ltd",
        billingClientContact_country_name: "United States",
        tob_agreed: "Agreed",
        po_required: "Yes",
        po_number: "PO-123",
        finance_ref_number: "FIN-001",
        billingClientContact_name: "Janet Mills",
        billingClientContact_full_address: "1 Main St, Houston, TX, 77001, United States",
      },
    });
  });
});
