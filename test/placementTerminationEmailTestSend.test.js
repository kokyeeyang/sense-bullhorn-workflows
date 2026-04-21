const { buildTestSparkPostPayload } = require("../src/placementTerminationEmailTestSend");

describe("placementTerminationEmailTestSend", () => {
  test("builds the expected dummy payload for the termination template", () => {
    expect(
      buildTestSparkPostPayload({
        PLACEMENT_TERMINATION_SPARKPOST_TEMPLATE_ID: "placement-termination",
      }),
    ).toEqual({
      content: {
        template_id: "placement-termination",
      },
      recipients: [
        {
          placement: {
            id: "123456",
            status: "Terminated",
          },
          address: {
            email: "yeeyang.kok@spencer-ogden.com",
          },
          substitution_data: {
            owner_firstName: "Yee Yang",
            placement_id: "123456",
            placement_status: "Terminated",
            candidate_name: "Yee Yang Kok",
            candidate_email: "yeeyang.kok@spencer-ogden.com",
            client_company_name: "Test company 123",
            job_title: "Consultant",
            date_begin: "1 April 2026",
            date_end: "30 April 2026",
          },
        },
        {
          placement: {
            id: "432432423",
            status: "Terminated",
          },
          address: {
            email: "yee_yang94@hotmail.com",
          },
          substitution_data: {
            owner_firstName: "Yee Yang",
            placement_id: "432432423",
            placement_status: "Terminated",
            candidate_name: "Yee Yang Kok",
            candidate_email: "yee_yang94@hotmail.com",
            client_company_name: "Test company hotmail",
            job_title: "Consultant",
            date_begin: "1 April 2026",
            date_end: "30 April 2026",
          },
        },
      ],
    });
  });
});
