const {
  buildPlacementTerminationRecipient,
  isTerminatedPlacementStatusChange,
} = require("../src/utils/placementTerminationEmailUtils");

test("matches any transition whose new placement status is terminated", () => {
  expect(
    isTerminatedPlacementStatusChange({
      oldValue: "approved",
      newValue: "terminated",
    }),
  ).toBe(true);
});

test("rejects non-terminated transitions", () => {
  expect(
    isTerminatedPlacementStatusChange({
      oldValue: "approved",
      newValue: "completed",
    }),
  ).toBe(false);
});

test("builds a placement termination SparkPost recipient", () => {
  expect(
    buildPlacementTerminationRecipient({
      owner: {
        firstName: "Jazzey",
      },
      recipientEmail: "owner@example.com",
      placement: {
        id: 49086,
        status: "Terminated",
        dateBegin: 1774828800000,
        dateEnd: 1775260800000,
        candidate: {
          firstName: "Sammy",
          lastName: "Thackeray",
          email: "sammy@example.com",
        },
        clientCorporation: {
          name: "Bubbles Oil",
        },
        jobOrder: {
          title: "QA Analyst",
          owner: {
            firstName: "Olivia",
          },
        },
      },
    }),
  ).toEqual({
    address: {
      email: "owner@example.com",
    },
    substitution_data: {
      owner_firstName: "Jazzey",
      placement_id: "49086",
      placement_status: "Terminated",
      candidate_name: "Sammy Thackeray",
      candidate_email: "sammy@example.com",
      client_company_name: "Bubbles Oil",
      job_title: "QA Analyst",
      date_begin: "30 March 2026",
      date_end: "4 April 2026",
    },
  });
});
