const {
  getIllinoisInterviewJobOrderMatchDetails,
  matchesIllinoisInterviewJobOrder,
} = require("../src/interviewIllinoisEmailUtils");

describe("interviewIllinoisEmailUtils", () => {
  test("matches when jobOrder dateAdded is on or after the configured date", () => {
    expect(
      matchesIllinoisInterviewJobOrder({
        appointment: {
          jobOrder: {
            dateAdded: "2024-05-01T08:30:00.000Z",
            employmentType: "contract",
            address: {
              state: "Illinois",
            },
          },
        },
        config: {
          INTERVIEW_ILLINOIS_JOB_ORDER_STATE: "Illinois",
          INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED: "2024-05-01",
          INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "contract",
        },
      }),
    ).toBe(true);

    expect(
      matchesIllinoisInterviewJobOrder({
        appointment: {
          jobOrder: {
            dateAdded: "2024-05-03T08:30:00.000Z",
            employmentType: "contract",
            address: {
              state: "Illinois",
            },
          },
        },
        config: {
          INTERVIEW_ILLINOIS_JOB_ORDER_STATE: "Illinois",
          INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED: "2024-05-01",
          INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "contract",
        },
      }),
    ).toBe(true);
  });

  test("skips dateAdded and employmentType checks when those config values are blank", () => {
    expect(
      matchesIllinoisInterviewJobOrder({
        appointment: {
          jobOrder: {
            dateAdded: "2026-04-03T10:00:00.000Z",
            employmentType: "full-time",
            address: {
              state: "Illinois",
            },
          },
        },
        config: {
          INTERVIEW_ILLINOIS_JOB_ORDER_STATE: "Illinois",
          INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED: "",
          INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "",
        },
      }),
    ).toBe(true);
  });

  test("returns job order filter mismatch details", () => {
    expect(
      getIllinoisInterviewJobOrderMatchDetails({
        appointment: {
          jobOrder: {
            dateAdded: "2024-04-30T23:59:59.000Z",
            employmentType: "permanent",
            address: {
              state: "IL",
            },
          },
        },
        config: {
          INTERVIEW_ILLINOIS_JOB_ORDER_STATE: "Illinois",
          INTERVIEW_ILLINOIS_JOB_ORDER_DATE_ADDED: "2024-05-01",
          INTERVIEW_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "contract",
        },
      }),
    ).toEqual({
      matches: false,
      stateMatches: false,
      dateAddedMatches: false,
      employmentTypeMatches: false,
      actual: {
        state: "IL",
        dateAdded: "2024-04-30T23:59:59.000Z",
        employmentType: "permanent",
      },
      expected: {
        state: "Illinois",
        dateAdded: "2024-05-01",
        employmentType: "contract",
      },
    });
  });
});
