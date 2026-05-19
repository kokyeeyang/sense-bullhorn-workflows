const { resolveEventSubscriptionId } = require("../src/utils/eventSubscriptionConfig");

describe("resolveEventSubscriptionId", () => {
  test("uses the normal subscription ID when not in dry run", () => {
    const subscriptionId = resolveEventSubscriptionId({
      config: {
        DRY_RUN: false,
        LIVE_ID: "live-subscription",
        DRY_RUN_ID: "dry-run-subscription",
      },
      subscriptionIdKey: "LIVE_ID",
      dryRunSubscriptionIdKey: "DRY_RUN_ID",
    });

    expect(subscriptionId).toBe("live-subscription");
  });

  test("uses the dry-run subscription ID when dry run is enabled", () => {
    const subscriptionId = resolveEventSubscriptionId({
      config: {
        DRY_RUN: true,
        LIVE_ID: "live-subscription",
        DRY_RUN_ID: "dry-run-subscription",
      },
      subscriptionIdKey: "LIVE_ID",
      dryRunSubscriptionIdKey: "DRY_RUN_ID",
    });

    expect(subscriptionId).toBe("dry-run-subscription");
  });

  test("falls back to the normal subscription ID when the dry-run ID is blank", () => {
    const subscriptionId = resolveEventSubscriptionId({
      config: {
        DRY_RUN: true,
        LIVE_ID: "live-subscription",
        DRY_RUN_ID: " ",
      },
      subscriptionIdKey: "LIVE_ID",
      dryRunSubscriptionIdKey: "DRY_RUN_ID",
    });

    expect(subscriptionId).toBe("live-subscription");
  });
});
