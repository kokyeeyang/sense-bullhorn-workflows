const {
  buildInlineEmailContent,
  buildJobApplicationRecipient,
  buildThemedHtmlBody,
  getApplicationSource,
  getJobApplicationNotificationMatchDetails,
} = require("../src/utils/jobApplicationNotificationUtils");

describe("jobApplicationNotificationUtils", () => {
  test("matches the broad job board rule by source and owner pager", () => {
    const details = getJobApplicationNotificationMatchDetails({
      jobSubmission: {
        source: "LinkedIn Recruiter",
        dateAdded: "2026-05-14T01:00:00.000Z",
        jobOrder: {
          clientCorporation: { id: 123 },
        },
      },
      owner: {
        id: 99,
        pager: "500",
      },
      config: {},
    });

    expect(details.matches).toBe(true);
    expect(details.matchedRule).toBe("applications-from-all-job-boards");
  });

  test("uses JobSubmission source rather than candidate source", () => {
    expect(
      getApplicationSource({
        source: "Indeed",
        candidate: {
          source: "spencer ogden website",
        },
      }),
    ).toBe("Indeed");

    expect(
      getApplicationSource({
        candidate: {
          source: "spencer ogden website",
        },
      }),
    ).toBe("");
  });

  test("does not match same-email Iberdrola applications when the broad rule does not match", () => {
    const details = getJobApplicationNotificationMatchDetails({
      jobSubmission: {
        dateAdded: "2025-05-21T00:00:00.000Z",
        candidate: {
          source: "spencer ogden website",
        },
        jobOrder: {
          clientCorporation: { id: 6985 },
        },
      },
      owner: {
        id: 3235896,
        pager: "499",
      },
      config: {},
    });

    expect(details.matches).toBe(false);
    expect(details.matchedRule).toBeNull();
  });

  test("builds the inline SparkPost content from the Sense copy", () => {
    const content = buildInlineEmailContent({
      owner: {
        firstName: "Pat",
      },
      jobSubmission: {
        source: "Indeed",
        candidate: {
          id: 123,
          firstName: "Alex",
          lastName: "Morgan",
        },
        jobOrder: {
          id: 456,
          title: "Project Manager",
          clientCorporation: {
            name: "Acme Energy",
          },
        },
      },
    });

    expect(content.from).toEqual({
      name: "Sales Operations Team",
      email: "noreply@spencer-ogden.com",
    });
    expect(content.subject).toBe("New Application for Job: 456 - Project Manager");
    expect(content.text).toContain("Hi Pat,");
    expect(content.text).toContain("Source: Indeed");
    expect(content.text).toContain("ID: 123");
    expect(content.text).toContain("Name: Alex Morgan");
    expect(content.html).toContain("<!doctype html>");
    expect(content.html).toContain("background-color:#f4f6f8");
    expect(content.html).toContain("max-width:680px");
    expect(content.html).toContain("border:1px solid #d9dee7");
    expect(content.html).toContain("Kind Regards,<br>");
    expect(content.html).toContain("Sales Operations Team");
  });

  test("escapes dynamic values in the themed HTML body", () => {
    const html = buildThemedHtmlBody({
      owner: {
        firstName: "Pat <Lead>",
      },
      jobSubmission: {
        source: "Indeed & LinkedIn",
        candidate: {
          id: 123,
          name: "Alex <Morgan>",
        },
        jobOrder: {
          id: 456,
          title: "Project <Manager>",
          clientCorporation: {
            name: "Acme & Energy",
          },
        },
      },
    });

    expect(html).toContain("Pat &lt;Lead&gt;");
    expect(html).toContain("Indeed &amp; LinkedIn");
    expect(html).toContain("Alex &lt;Morgan&gt;");
    expect(html).not.toContain("Alex <Morgan>");
  });

  test("builds recipient substitution data for reports and auditability", () => {
    expect(
      buildJobApplicationRecipient({
        recipientEmail: "owner@example.com",
        matchedRule: "applications-from-all-job-boards",
        owner: {
          id: 99,
          firstName: "Pat",
        },
        jobSubmission: {
          id: 77,
          source: "Adzuna",
          candidate: {
            id: 123,
            name: "Alex Morgan",
          },
          jobOrder: {
            id: 456,
            title: "Project Manager",
            clientCorporation: {
              id: 888,
              name: "Acme Energy",
            },
          },
        },
      }),
    ).toEqual({
      address: {
        email: "owner@example.com",
      },
      substitution_data: {
        job_submission_id: "77",
        matched_rule: "applications-from-all-job-boards",
        source: "Adzuna",
        job_order_id: "456",
        job_order_title: "Project Manager",
        client_corporation_id: "888",
        client_corporation_name: "Acme Energy",
        candidate_id: "123",
        candidate_name: "Alex Morgan",
        owner_id: "99",
        owner_first_name: "Pat",
        owner_email: "owner@example.com",
      },
    });
  });
});
