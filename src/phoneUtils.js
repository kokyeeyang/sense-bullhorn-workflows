const { areaCodeToState } = require("./areaCodeToState");
const { countryIdToCountry } = require("./countryIdToCountry");

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
    if (digits.startsWith("1") && digits.length >= 11) {
      return {
        digits,
        countryCallingCode: 1,
        nationalDigits: digits.slice(1),
      };
    }

    return {
      digits,
      countryCallingCode: null,
      nationalDigits: digits,
    };
  }

  if (digits.length === 10) {
    return { digits, countryCallingCode: 1, nationalDigits: digits };
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return { digits, countryCallingCode: 1, nationalDigits: digits.slice(1) };
  }

  if (/^04\d{8}$/.test(digits)) {
    return { digits, countryCallingCode: null, nationalDigits: digits };
  }

  if (digits.length >= 11) {
    return {
      digits,
      countryCallingCode: null,
      nationalDigits: digits,
    };
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
    }
  }

  const countryId = Number(candidate.address?.countryID || 0);
  const mappedCountry = countryIdToCountry[countryId];
  if (mappedCountry && mappedCountry.countryCode !== "US") {
    return {
      addressPatch: {
        countryID: countryId,
        countryCode: mappedCountry.countryCode,
        countryName: mappedCountry.countryName,
      },
      mappingType: "country-id",
    };
  }

  return null;
}

module.exports = { extractAreaCode, parsePhone, inferAddressUpdateFromCandidate };
