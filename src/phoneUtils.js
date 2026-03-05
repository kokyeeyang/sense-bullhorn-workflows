const { areaCodeToState } = require("./areaCodeToState");
const {
  callingCodeToCountryName,
  callingCodeToCountryCode,
  callingCodeToCountryId,
} = require("./callingCodeToRegion");

function extractAreaCode(value) {
  if (!value || typeof value !== "string") return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length < 10) return null;

  return normalized.slice(0, 3);
}

function parsePhone(value) {
  if (!value || typeof value !== "string") return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  const hasIntlPrefix = value.trim().startsWith("+") || value.trim().startsWith("00");

  if (hasIntlPrefix) {
    for (let len = 3; len >= 1; len -= 1) {
      const code = Number(digits.slice(0, len));
      if (callingCodeToCountryName[code] || code === 1) {
        return {
          digits,
          countryCallingCode: code,
          nationalDigits: digits.slice(len),
        };
      }
    }
  }

  // Some records store international numbers without '+'.
  if (digits.length >= 8) {
    for (let len = 3; len >= 1; len -= 1) {
      const code = Number(digits.slice(0, len));
      if (callingCodeToCountryName[code]) {
        return {
          digits,
          countryCallingCode: code,
          nationalDigits: digits.slice(len),
        };
      }
    }
  }

  // Fallback for local formatting without explicit +1.
  if (digits.length === 10) {
    return { digits, countryCallingCode: 1, nationalDigits: digits };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return { digits, countryCallingCode: 1, nationalDigits: digits.slice(1) };
  }

  return null;
}

function inferAddressUpdateFromCandidate(candidate) {
  const phoneFields = [candidate.phone, candidate.mobile, candidate.phone2, candidate.phone3];

  for (const phone of phoneFields) {
    const parsed = parsePhone(phone);
    if (!parsed) continue;

    if (parsed.countryCallingCode === 1) {
      if (!parsed.nationalDigits || parsed.nationalDigits.length < 10) continue;
      const areaCode = parsed.nationalDigits.slice(0, 3);
      const state = areaCodeToState[areaCode];
      if (state) {
        return {
          addressPatch: { state },
          areaCode,
          phoneUsed: phone,
          mappingType: "us-area-code",
        };
      }
      continue;
    }

    const countryName = callingCodeToCountryName[parsed.countryCallingCode];
    if (countryName) {
      const countryCode = callingCodeToCountryCode[parsed.countryCallingCode] || null;
      const countryId = callingCodeToCountryId[parsed.countryCallingCode] || null;
      const addressPatch = { countryName };
      if (countryCode) addressPatch.countryCode = countryCode;
      if (countryId) addressPatch.countryID = countryId;

      return {
        addressPatch,
        callingCode: String(parsed.countryCallingCode),
        phoneUsed: phone,
        mappingType: "country-calling-code",
      };
    }
  }

  return null;
}

module.exports = { extractAreaCode, parsePhone, inferAddressUpdateFromCandidate };
