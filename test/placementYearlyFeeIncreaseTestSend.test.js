const { buildTestSparkPostPayload } = require("../src/placementYearlyFeeIncreaseTestSend");

describe("placementYearlyFeeIncreaseTestSend", () => {
  test("builds the expected SparkPost payload", () => {
    expect(
      buildTestSparkPostPayload({
        PLACEMENT_YEARLY_FEE_INCREASE_SPARKPOST_TEMPLATE_ID: "placement-yearly-fee-increase",
      }),
    ).toEqual({
      content: {
        template_id: "placement-yearly-fee-increase",
      },
      recipients: [
        {
          address: {
            email: "yeeyang.kok@spencer-ogden.com",
          },
          substitution_data: {
            owner_firstName: "Yee Yang Kok",
            client_company_name: "Test company 123",
            yearly_fee_increase_percent: "5",
            placement_id: "123456",
            candidate_name: "Test Candidate",
            placement_start_date: "7 April 2025",
            placement_end_date: "7 April 2026",
            job_title: "Offshore Lead Cables Engineer",
            tob_date: "1 January 2024",
          },
        },
        {
          address: {
            email: "yee_yang94@hotmail.com",
          },
          substitution_data: {
            owner_firstName: "Yee Yang Kok",
            client_company_name: "Test company hotmail",
            yearly_fee_increase_percent: "3",
            placement_id: "432432423",
            candidate_name: "Test Candidate Two",
            placement_start_date: "8 April 2025",
            placement_end_date: "8 April 2026",
            job_title: "Senior Consultant",
            tob_date: "15 February 2024",
          },
        },
      ],
    });
  });
});
