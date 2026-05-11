const {
  RULES,
  WORKFLOW_NAME,
  buildInlineTransmission,
  findMatchingRule,
  getRuleMatchDetails,
} = require("../src/utils/emeaPlacementAutoReplyUtils");

function buildPlacement(overrides = {}) {
  return {
    id: 5001,
    status: "Pre-Hire",
    employmentType: "Contract",
    owner: {
      id: 91,
      firstName: "Alex",
      lastName: "Owner",
      email: "alex@example.com",
      primaryDepartment: { name: "LON - Contract Renewables" },
    },
    candidate: {
      id: 7001,
      firstName: "Ava",
      lastName: "Tan",
      email: "ava@example.com",
    },
    clientCorporation: {
      id: 8001,
      name: "Acme Energy",
    },
    ...overrides,
  };
}

describe("emeaPlacementAutoReplyUtils", () => {
  test("matches EMEA contract pre-hire placement", () => {
    const rule = RULES.find((item) => item.key === "emea-contract-placement-auto-reply");
    const details = getRuleMatchDetails({
      placement: buildPlacement(),
      rule,
      statusChange: { oldValue: "Submitted", newValue: "Pre-Hire" },
    });

    expect(details.matched).toBe(true);
  });

  test("germany rules take precedence before broader EMEA rules", () => {
    const placement = buildPlacement({
      employmentType: "Contract",
      owner: {
        id: 91,
        email: "alex@example.com",
        primaryDepartment: { name: "DUS - Contract Renewables" },
      },
    });

    const rule = findMatchingRule({
      placement,
      statusChange: { oldValue: "Submitted", newValue: "Pre-Hire" },
    });

    expect(rule.key).toBe("germany-contract-placement-auto-reply");
  });

  test("matches EMEA perm and accepts permanent employment type", () => {
    const placement = buildPlacement({
      employmentType: "Permanent",
      owner: {
        id: 91,
        email: "alex@example.com",
        primaryDepartment: { name: "LON - Perm Finance" },
      },
    });

    const rule = findMatchingRule({
      placement,
      statusChange: { oldValue: "Submitted", newValue: "Pre-Hire" },
    });

    expect(rule.key).toBe("emea-perm-placement-auto-reply");
  });

  test("does not match when status change is not to pre-hire", () => {
    const rule = RULES.find((item) => item.key === "emea-contract-placement-auto-reply");
    const details = getRuleMatchDetails({
      placement: buildPlacement({ status: "Submitted" }),
      rule,
      statusChange: { oldValue: "Pre-Hire", newValue: "Submitted" },
    });

    expect(details.matched).toBe(false);
    expect(details.failedChecks).toContain("statusChangeToPreHire");
  });

  test("builds owner email transmission", () => {
    const rule = RULES.find((item) => item.key === "emea-contract-placement-auto-reply");
    const transmission = buildInlineTransmission({
      placement: buildPlacement(),
      rule,
    });

    expect(WORKFLOW_NAME).toBe("emea-placement-auto-reply-sync");
    expect(transmission.recipients[0].address.email).toBe("alex@example.com");
    expect(transmission.content.from.email).toBe("emea.ccs@spencer-ogden.com");
    expect(transmission.content.subject).toBe("Congratulations");
    expect(transmission.content.html).toContain("Congratulations on making your placement");
  });
});
