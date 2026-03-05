const axios = require("axios");

class BullhornClient {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  async getAuthorizationCode() {
    const url = `${this.config.BULLHORN_AUTH_BASE_URL}/oauth/authorize`;
    const params = {
      client_id: this.config.BULLHORN_CLIENT_ID,
      response_type: "code",
      username: this.config.BULLHORN_USERNAME,
      password: this.config.BULLHORN_PASSWORD,
      state: "workflow",
      redirect_uri: this.config.BULLHORN_REDIRECT_URI,
      action: "Login",
    };

    const response = await axios.get(url, {
      params,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const location = response.headers.location;
    if (!location) {
      throw new Error("Bullhorn authorize response did not include a redirect location");
    }

    const redirect = new URL(location);
    const code = redirect.searchParams.get("code");
    if (!code) {
      throw new Error("Bullhorn authorize redirect did not include authorization code");
    }

    return code;
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

  async searchCandidates({ restUrl, bhRestToken, fromEpochSeconds, toEpochSeconds }) {
    const fields = [
      "id",
      "firstName",
      "lastName",
      "phone",
      "mobile",
      "phone2",
      "phone3",
      "address(state)",
      "dateAdded",
    ].join(",");

    const all = [];
    const pageSize = 500;
    let start = 0;
    let total = 0;

    do {
      const response = await axios.get(`${restUrl}/search/Candidate`, {
        params: {
          BhRestToken: bhRestToken,
          query: `dateAdded[${fromEpochSeconds} TO ${toEpochSeconds}]`,
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

  async updateCandidateState({ restUrl, bhRestToken, candidateId, state }) {
    const url = `${restUrl}/entity/Candidate/${candidateId}`;

    await axios.post(
      url,
      { address: { state } },
      { params: { BhRestToken: bhRestToken } },
    );
  }
}

module.exports = { BullhornClient };
