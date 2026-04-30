const {
  getClientCorporationChanges,
  hasClientCorporationDelayPassed,
  isEmptyCustomText7,
  isListedClientCorporationName,
} = require("./clientCorporation360Utils");

function inferClientCorporationKeyAccountPatch(
  clientCorporation,
  { delayHours = 24, now = Date.now() } = {},
) {
  if (!isEmptyCustomText7(clientCorporation?.customText7)) {
    return null;
  }

  if (!isListedClientCorporationName(clientCorporation?.name)) {
    return null;
  }

  if (!hasClientCorporationDelayPassed(clientCorporation, delayHours, now)) {
    return null;
  }

  return {
    customText7: "Key Account",
  };
}

module.exports = {
  getClientCorporationChanges,
  hasClientCorporationDelayPassed,
  inferClientCorporationKeyAccountPatch,
  isEmptyCustomText7,
  isListedClientCorporationName,
};
