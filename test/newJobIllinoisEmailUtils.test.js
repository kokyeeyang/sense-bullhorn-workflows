const {
  buildNewJobIllinoisRecipient,
  buildUtcAgeWindow,
  matchesNewJobIllinoisJobOrder,
} = require("../src/utils/newJobIllinoisEmailUtils");

describe("newJobIllinoisEmailUtils", () => {
  test("builds a 24-to-48 hour old window by default", () => {
    const window = buildUtcAgeWindow({
      baseDate: new Date("2026-04-15T15:00:00.000Z"),
    });

    expect(window).toEqual({
      startMs: new Date("2026-04-13T15:00:00.000Z").getTime(),
      endMs: new Date("2026-04-14T15:00:00.000Z").getTime(),
      graceHours: 24,
      intervalHours: 24,
    });
  });

  test("matches Illinois contract job orders case-insensitively", () => {
    expect(
      matchesNewJobIllinoisJobOrder({
        jobOrder: {
          employmentType: "CONTRACT",
          address: {
            state: "ILLINOIS",
          },
        },
        config: {
          NEW_JOB_ILLINOIS_JOB_ORDER_STATE: "illinois",
          NEW_JOB_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "contract",
        },
      }),
    ).toBe(true);

    expect(
      matchesNewJobIllinoisJobOrder({
        jobOrder: {
          employmentType: "permanent",
          address: {
            state: "Illinois",
          },
        },
        config: {
          NEW_JOB_ILLINOIS_JOB_ORDER_STATE: "Illinois",
          NEW_JOB_ILLINOIS_JOB_ORDER_EMPLOYMENT_TYPE: "contract",
        },
      }),
    ).toBe(false);
  });

  test("builds SparkPost recipient substitution data", () => {
    expect(
      buildNewJobIllinoisRecipient({
        recipientEmail: "owner@example.com",
        owner: {
          id: 42,
          firstName: "Pat",
          lastName: "Lee",
        },
        jobOrder: {
          id: 49086,
          dateAdded: 1776246000000,
          employmentType: "contract",
          address: { state: "Illinois" },
          clientCorporation: { name: "Acme Corp" },
        },
      }),
    ).toEqual({
      address: {
        email: "owner@example.com",
      },
      substitution_data: {
        id: "49086",
        job_order_id: "49086",
        client_corporation_name: "Acme Corp",
        job_order_date_added: 1776246000000,
        job_order_employment_type: "contract",
        job_order_state: "Illinois",
        owner_id: "42",
        owner_first_name: "Pat",
        owner_last_name: "Lee",
        owner_email: "owner@example.com",
      },
    });
  });
});
