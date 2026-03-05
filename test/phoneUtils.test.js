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

test("maps international number by country calling code", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "+60 12-345 6789",
    mobile: null,
    phone2: null,
    phone3: null,
  });

  assert.equal(result.addressPatch.countryName, "Malaysia");
  assert.equal(result.addressPatch.countryCode, "MY");
  assert.equal(result.addressPatch.countryID, 2291);
  assert.equal(result.mappingType, "country-calling-code");
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
