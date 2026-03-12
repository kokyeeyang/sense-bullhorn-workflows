const { inferAddressUpdateFromCandidate } = require("../src/phoneUtils");

test("maps US +1 number by area code", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "+1 515-555-0100",
    mobile: null,
    phone2: null,
    phone3: null,
  });

  expect(result.addressPatch.state).toBe("IA");
  expect(result.mappingType).toBe("us-area-code");
});

test("maps non-US by countryID", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: null,
    mobile: null,
    phone2: null,
    phone3: null,
    address: { countryID: 2291 },
  });

  expect(result.addressPatch.countryName).toBe("Malaysia");
  expect(result.addressPatch.countryCode).toBe("MY");
  expect(result.addressPatch.countryID).toBe(2291);
  expect(result.mappingType).toBe("country-id");
});

test("maps AU local mobile format with countryID to Australia", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "0401000000",
    mobile: null,
    phone2: null,
    phone3: null,
    address: { countryID: 2194 },
  });

  expect(result.addressPatch.countryName).toBe("Australia");
  expect(result.addressPatch.countryCode).toBe("AU");
  expect(result.addressPatch.countryID).toBe(2194);
  expect(result.mappingType).toBe("country-id");
});

test("returns null if no mapping found", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "+999 123 4567",
    mobile: null,
    phone2: null,
    phone3: null,
  });

  expect(result).toBeNull();
});
