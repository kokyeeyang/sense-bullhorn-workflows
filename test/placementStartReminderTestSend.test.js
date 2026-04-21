const { buildTestSparkPostPayload } = require("../src/placementStartReminderTestSend");

describe("placementStartReminderTestSend", () => {
  test("builds the expected SparkPost payload", () => {
    expect(
      buildTestSparkPostPayload({
        SPARKPOST_TEMPLATE_ID: "test-yy",
      }),
    ).toEqual({
      content: {
        template_id: "test-yy",
      },
      recipients: [
        {
          address: {
            email: "yeeyang.kok@spencer-ogden.com",
          },
          substitution_data: {
            placement_id: "123456",
            jobOrderOwner_firstName: "Yee Yang",
            candidate_name: "Test Candidate",
            client_company_name: "Test company 123",
            date_begin: "31 April 2026",
            so_entity: "SO Italy",
            legal_entity_name: "Test company so legal entity name",
            billingClientContact_country_name: "Italy",
            tob_agreed: "Yes",
            po_required: "Yes",
            po_number: "PO-778899",
            finance_ref_number: "XXECOS01",
            billingClientContact_name: "Danilo Contu",
            billingClientContact_full_address:
              "Via Ricotti, 5 Voghera (PV) Italy, Voghera, N/A, 27058, Italy",
          },
        },
        {
          address: {
            email: "yee_yang94@hotmail.com",
          },
          substitution_data: {
            placement_id: "432432423",
            jobOrderOwner_firstName: "Yee Yang",
            candidate_name: "Test Candidate",
            client_company_name: "Test company hotmail",
            date_begin: "31 April 2026",
            so_entity: "SO Malaysia",
            legal_entity_name: "Test company hotmail legal entity name",
            billingClientContact_country_name: "Malaysia",
            tob_agreed: "Yes",
            po_required: "Yes",
            po_number: "PO-123456",
            finance_ref_number: "XXECOS01",
            billingClientContact_name: "Tom",
            billingClientContact_full_address: "asdasdas",
          },
        },
      ],
    });
  });
});
