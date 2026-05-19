function resolveEventSubscriptionId({ config, subscriptionIdKey, dryRunSubscriptionIdKey }) {
  const subscriptionId = String(config[subscriptionIdKey] || "").trim();
  const dryRunSubscriptionId = String(config[dryRunSubscriptionIdKey] || "").trim();

  if (config.DRY_RUN && dryRunSubscriptionId) {
    return dryRunSubscriptionId;
  }

  return subscriptionId;
}

module.exports = { resolveEventSubscriptionId };
