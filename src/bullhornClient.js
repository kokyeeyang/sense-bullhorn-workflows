const axios = require("axios");

function redactUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const sensitiveKeys = ["password", "client_secret", "access_token", "code"];

    for (const key of sensitiveKeys) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "***REDACTED***");
      }
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

class BullhornClient {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  async getAuthorizationCode() {
    const params = new URLSearchParams({
      client_id: this.config.BULLHORN_CLIENT_ID,
      response_type: "code",
      username: this.config.BULLHORN_USERNAME,
      password: this.config.BULLHORN_PASSWORD,
      state: "workflow",
      redirect_uri: this.config.BULLHORN_REDIRECT_URI,
      action: "Login",
    });

    let currentUrl = `${this.config.BULLHORN_AUTH_BASE_URL}/oauth/authorize?${params.toString()}`;
    const maxHops = 10;

    for (let hop = 0; hop < maxHops; hop += 1) {
      const response = await axios.get(currentUrl, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const currentParsed = new URL(currentUrl);
      const code = currentParsed.searchParams.get("code");
      if (code) return code;

      const oauthError = currentParsed.searchParams.get("error");
      const oauthErrorDescription = currentParsed.searchParams.get("error_description");
      if (oauthError || oauthErrorDescription) {
        const details = [
          "Bullhorn authorize redirect returned OAuth error",
          `url: ${redactUrl(currentUrl)}`,
        ];
        if (oauthError) details.push(`error: ${oauthError}`);
        if (oauthErrorDescription) details.push(`error_description: ${oauthErrorDescription}`);
        throw new Error(details.join(" | "));
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location) {
          throw new Error(
            `Bullhorn authorize response did not include redirect location (status: ${response.status}, url: ${redactUrl(currentUrl)})`,
          );
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const details = [
        "Bullhorn authorize ended without authorization code",
        `status: ${response.status}`,
        `url: ${redactUrl(currentUrl)}`,
      ];
      throw new Error(details.join(" | "));
    }

    throw new Error(
      `Bullhorn authorize exceeded redirect limit (${maxHops}) without authorization code`,
    );
  }

  async getAccessToken(authCode) {
    const url = `${this.config.BULLHORN_AUTH_BASE_URL}/oauth/token`;
    const response = await axios.post(
      url,
      null,
      {
        params: {
          grant_type: "authorization_code",
          code: authCode,
          client_id: this.config.BULLHORN_CLIENT_ID,
          client_secret: this.config.BULLHORN_CLIENT_SECRET,
          redirect_uri: this.config.BULLHORN_REDIRECT_URI,
        },
      },
    );

    return response.data.access_token;
  }

  async login(accessToken) {
    const loginBase = this.config.BULLHORN_API_BASE_URL || this.config.BULLHORN_AUTH_BASE_URL;
    const url = `${loginBase}/rest-services/login`;

    const response = await axios.get(url, {
      params: {
        access_token: accessToken,
        version: this.config.BULLHORN_API_VERSION,
      },
    });

    return {
      bhRestToken: response.data.BhRestToken,
      restUrl: response.data.restUrl?.replace(/\/$/, ""),
    };
  }

  async searchCandidates({
    restUrl,
    bhRestToken,
    fromEpochSeconds,
    toEpochSeconds,
    candidateId,
  }) {
    const fields = [
      "id",
      "firstName",
      "lastName",
      "phone",
      "mobile",
      "phone2",
      "phone3",
      "address",
      "dateAdded",
    ].join(",");

    const all = [];
    const pageSize = 500;
    let start = 0;
    let total = 0;
    const query =
      candidateId && Number.isInteger(candidateId)
        ? `id:${candidateId}`
        : `dateAdded[${fromEpochSeconds} TO ${toEpochSeconds}]`;

    do {
      const response = await axios.get(`${restUrl}/search/Candidate`, {
        params: {
          BhRestToken: bhRestToken,
          query,
          fields,
          count: pageSize,
          start,
        },
      });

      const { data = [], total: reportedTotal = 0 } = response.data;
      total = reportedTotal;
      all.push(...data);
      start += data.length;
    } while (start < total);

    return all;
  }

  async updateCandidateAddress({ restUrl, bhRestToken, candidateId, addressPatch }) {
    const url = `${restUrl}/entity/Candidate/${candidateId}`;

    await axios.post(
      url,
      { address: addressPatch },
      { params: { BhRestToken: bhRestToken } },
    );
  }
}

module.exports = { BullhornClient };
