const test = require("node:test");
const assert = require("node:assert/strict");

const { inferAddressUpdateFromCandidate } = require("../src/phoneUtils");

test("maps US +1 number by area code", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "+1 515-555-0100",
    mobile: null,
    phone2: null,
    phone3: null,
  });

  assert.equal(result.addressPatch.state, "IA");
  assert.equal(result.mappingType, "us-area-code");
});

test("maps non-US by countryID", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: null,
    mobile: null,
    phone2: null,
    phone3: null,
    address: { countryID: 2291 },
  });

  assert.equal(result.addressPatch.countryName, "Malaysia");
  assert.equal(result.addressPatch.countryCode, "MY");
  assert.equal(result.addressPatch.countryID, 2291);
  assert.equal(result.mappingType, "country-id");
});

test("maps AU local mobile format with countryID to Australia", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "0401000000",
    mobile: null,
    phone2: null,
    phone3: null,
    address: { countryID: 2194 },
  });

  assert.equal(result.addressPatch.countryName, "Australia");
  assert.equal(result.addressPatch.countryCode, "AU");
  assert.equal(result.addressPatch.countryID, 2194);
  assert.equal(result.mappingType, "country-id");
});

test("returns null if no mapping found", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "+999 123 4567",
    mobile: null,
    phone2: null,
    phone3: null,
  });

  assert.equal(result, null);
});
