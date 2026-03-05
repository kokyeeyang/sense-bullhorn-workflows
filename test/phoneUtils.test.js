const test = require("node:test");
const assert = require("node:assert/strict");

const { inferStateFromCandidate } = require("../src/phoneUtils");

test("maps US +1 number by area code", () => {
  const result = inferStateFromCandidate({
    phone: "+1 515-555-0100",
    mobile: null,
    phone2: null,
    phone3: null,
  });

  assert.equal(result.state, "IA");
  assert.equal(result.mappingType, "us-area-code");
});

test("maps international number by country calling code", () => {
  const result = inferStateFromCandidate({
    phone: "+60 12-345 6789",
    mobile: null,
    phone2: null,
    phone3: null,
  });

  assert.equal(result.state, "MY");
  assert.equal(result.mappingType, "country-calling-code");
});

test("returns null if no mapping found", () => {
  const result = inferStateFromCandidate({
    phone: "+999 123 4567",
    mobile: null,
    phone2: null,
    phone3: null,
  });

  assert.equal(result, null);
});
