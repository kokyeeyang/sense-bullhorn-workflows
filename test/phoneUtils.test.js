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

test("maps non-US by countryID when phone data is present", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "+60 12-345 6789",
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

test("maps Malaysia when phone starts with 601 and countryID is Malaysia", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "60123456789",
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

test("does not map non-US by countryID when phone data is missing", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: null,
    mobile: null,
    phone2: null,
    phone3: null,
    address: { countryID: 2291 },
  });

  expect(result).toBeNull();
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

test("maps non-US by phone calling code when countryID is missing", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "+60 12-345 6789",
    mobile: null,
    phone2: null,
    phone3: null,
    address: {},
  });

  expect(result.addressPatch.countryName).toBe("Malaysia");
  expect(result.addressPatch.countryCode).toBe("MY");
  expect(result.addressPatch.countryID).toBe(2291);
  expect(result.callingCode).toBe(60);
  expect(result.mappingType).toBe("phone-calling-code");
});

test("maps non-US by phone calling code without plus when countryID is missing", () => {
  const result = inferAddressUpdateFromCandidate({
    phone: "60123456789",
    mobile: null,
    phone2: null,
    phone3: null,
    address: {},
  });

  expect(result.addressPatch.countryName).toBe("Malaysia");
  expect(result.addressPatch.countryCode).toBe("MY");
  expect(result.addressPatch.countryID).toBe(2291);
  expect(result.callingCode).toBe(60);
  expect(result.mappingType).toBe("phone-calling-code");
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
