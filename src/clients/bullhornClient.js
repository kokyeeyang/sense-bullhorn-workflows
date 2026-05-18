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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFieldChanges(fieldChanges) {
  if (Array.isArray(fieldChanges)) {
    return fieldChanges;
  }

  if (Array.isArray(fieldChanges?.data)) {
    return fieldChanges.data;
  }

  return [];
}

function candidateStateFields() {
  return [
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
}

class BullhornClient {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  shouldRetry(error) {
    const status = error?.response?.status;
    if (!status) return true;
    return status === 429 || status >= 500;
  }

  async requestWithRetry({ label, fn }) {
    const maxAttempts = this.config.RETRY_MAX_ATTEMPTS;
    let attempt = 1;

    while (attempt <= maxAttempts) {
      try {
        return await fn();
      } catch (error) {
        const retryable = this.shouldRetry(error);
        const isLastAttempt = attempt === maxAttempts;

        if (!retryable || isLastAttempt) {
          throw error;
        }

        const jitterMs = Math.floor(Math.random() * 100);
        const delayMs =
          this.config.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitterMs;

        this.logger.warn(
          {
            label,
            attempt,
            maxAttempts,
            delayMs,
            status: error?.response?.status || null,
          },
          "Retrying Bullhorn API call",
        );

        await sleep(delayMs);
        attempt += 1;
      }
    }
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
      const response = await this.requestWithRetry({
        label: "oauth_authorize_hop",
        fn: () =>
          axios.get(currentUrl, {
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
          }),
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
    const response = await this.requestWithRetry({
      label: "oauth_token",
      fn: () =>
        axios.post(
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
        ),
    });

    return response.data.access_token;
  }

  async login(accessToken) {
    const loginBase = this.config.BULLHORN_API_BASE_URL || this.config.BULLHORN_AUTH_BASE_URL;
    const url = `${loginBase}/rest-services/login`;

    const response = await this.requestWithRetry({
      label: "rest_login",
      fn: () =>
        axios.get(url, {
          params: {
            access_token: accessToken,
            version: this.config.BULLHORN_API_VERSION,
          },
        }),
    });

    return {
      bhRestToken: response.data.BhRestToken,
      restUrl: response.data.restUrl?.replace(/\/$/, ""),
    };
  }

  async upsertEventSubscription({
    restUrl,
    bhRestToken,
    subscriptionId,
    entityName,
    eventType = "UPDATED",
  }) {
    const url = `${restUrl}/event/subscription/${subscriptionId}`;
    let response;
    try {
      response = await this.requestWithRetry({
        label: "upsert_event_subscription",
        fn: () =>
          axios.put(
            url,
            null,
            {
              params: {
                BhRestToken: bhRestToken,
                type: "entity",
                names: entityName,
                eventTypes: eventType,
              },
            },
          ),
      });
    } catch (error) {
      const status = error?.response?.status;
      const errorMessage = error?.response?.data?.errorMessage || "";
      if (status === 400 && /already exists/i.test(errorMessage)) {
        this.logger.info(
          { subscriptionId, entityName, eventType },
          "Bullhorn event subscription already exists; reusing subscription",
        );
        return { alreadyExists: true, subscriptionId };
      }
      throw error;
    }

    return response.data;
  }

  async consumeEvents({
    restUrl,
    bhRestToken,
    subscriptionId,
    maxEvents,
  }) {
    const url = `${restUrl}/event/subscription/${subscriptionId}`;

    const response = await this.requestWithRetry({
      label: "consume_events",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            maxEvents,
          },
        }),
    });

    return response.data;
  }

  async searchCandidates({
    restUrl,
    bhRestToken,
    fromEpochSeconds,
    toEpochSeconds,
    candidateId,
  }) {
    const fields = candidateStateFields();

    const all = [];
    const pageSize = 500;
    let start = 0;
    let total = 0;
    const query =
      candidateId && Number.isInteger(candidateId)
        ? `id:${candidateId}`
        : `dateAdded:[${fromEpochSeconds} TO ${toEpochSeconds}]`;

    do {
      const response = await this.requestWithRetry({
        label: "search_candidates",
        fn: () =>
          axios.get(`${restUrl}/search/Candidate`, {
            params: {
              BhRestToken: bhRestToken,
              query,
              fields,
              count: pageSize,
              start,
            },
          }),
      });

      const { data = [], total: reportedTotal = 0 } = response.data;
      total = reportedTotal;
      all.push(...data);
      start += data.length;
    } while (start < total);

    return all;
  }

  async searchClientCorporations({
    restUrl,
    bhRestToken,
    fromEpochSeconds,
    toEpochSeconds,
    clientCorporationId,
    maxCount = 500,
  }) {
    const fields = ["id", "name", "dateAdded", "customText7"].join(",");
    const all = [];
    let start = 0;
    let total = 0;
    const query =
      clientCorporationId && Number.isInteger(clientCorporationId)
        ? `id:${clientCorporationId}`
        : `dateAdded[${fromEpochSeconds} TO ${toEpochSeconds ?? "*"}]`;

    do {
      const remaining = Math.max(maxCount - all.length, 0);
      if (remaining === 0) {
        break;
      }

      const pageSize = Math.min(500, remaining);
      const response = await this.requestWithRetry({
        label: "search_client_corporations",
        fn: () =>
          axios.get(`${restUrl}/search/ClientCorporation`, {
            params: {
              BhRestToken: bhRestToken,
              query,
              fields,
              count: pageSize,
              start,
            },
          }),
      });

      const { data = [], total: reportedTotal = 0 } = response.data;
      total = reportedTotal;
      all.push(...data);
      start += data.length;
    } while (start < total && all.length < maxCount);

    return all.slice(0, maxCount);
  }

  async updateCandidateAddress({ restUrl, bhRestToken, candidateId, addressPatch }) {
    const url = `${restUrl}/entity/Candidate/${candidateId}`;

    await this.requestWithRetry({
      label: "update_candidate_address",
      fn: () =>
        axios.post(
          url,
          { address: addressPatch },
          { params: { BhRestToken: bhRestToken } },
        ),
    });
  }

  async getPlacement({ restUrl, bhRestToken, placementId }) {
    const url = `${restUrl}/entity/Placement/${placementId}`;

    const response = await this.requestWithRetry({
      label: "get_placement",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            fields: [
              "id",
              "status",
              "dateLastModified",
              "payRate",
              "customText8",
              "customText18",
              "customText60",
              "dateBegin",
              "dateEnd",
              "employmentType",
              "candidate(id,firstName,lastName,email,companyName,occupation,status,dateAvailable,hourlyRateLow)",
              "clientCorporation(id,name,customText2,customText10,customText11,customDate1,billingFrequency)",
              "billingClientContact(id,firstName,lastName,customText3,address)",
              "jobOrder(id,title,employmentType,owner(id,firstName,lastName))",
            ].join(","),
          },
        }),
    });

    return response.data.data;
  }

  async getPlacementByIdWithFields({ restUrl, bhRestToken, placementId, fields }) {
    const url = `${restUrl}/entity/Placement/${placementId}`;

    const response = await this.requestWithRetry({
      label: "get_placement_by_id_with_fields",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            fields,
          },
        }),
    });

    return response.data.data;
  }

  async getClientCorporationContacts({
    restUrl,
    bhRestToken,
    clientCorporationId,
    count = 500,
  }) {
    const fields = [
      "id",
      "name",
      "firstName",
      "lastName",
      "dateAdded",
      "status",
      "massMailOptOut",
      "clientCorporation(id,name,status)",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: "get_client_corporation_contacts",
        fn: () =>
          axios.get(`${restUrl}/entity/ClientCorporation/${clientCorporationId}/clientContacts`, {
            params: {
              BhRestToken: bhRestToken,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryPlacementEditHistoryByDateAddedRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
    maxCount = Infinity,
  }) {
    const fields = [
      "id",
      "dateAdded",
      "transactionID",
      "targetEntity(id)",
      "fieldChanges(columnName,oldValue,newValue)",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const remaining = Math.max(maxCount - all.length, 0);
      if (remaining === 0) {
        break;
      }
      const pageSize = Math.min(count, remaining);
      const response = await this.requestWithRetry({
        label: "query_placement_edit_history_by_date_added_range",
        fn: () =>
          axios.get(`${restUrl}/query/PlacementEditHistory`, {
            params: {
              BhRestToken: bhRestToken,
              where: `dateAdded>=${startMs} AND dateAdded<${endMs}`,
              fields,
              count: pageSize,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < pageSize) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryEntityEditHistoryByDateAddedRange({
    restUrl,
    bhRestToken,
    entityName,
    startMs,
    endMs,
    count = 200,
  }) {
    const fields = [
      "id",
      "dateAdded",
      "transactionID",
      "targetEntity(id)",
      "fieldChanges(columnName,oldValue,newValue)",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: `query_${entityName.toLowerCase()}_edit_history_by_date_added_range`,
        fn: () =>
          axios.get(`${restUrl}/query/${entityName}EditHistory`, {
            params: {
              BhRestToken: bhRestToken,
              where: `dateAdded>=${startMs} AND dateAdded<${endMs}`,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async searchClientContacts({
    restUrl,
    bhRestToken,
    fromEpochSeconds,
    toEpochSeconds,
    clientContactId,
    excludeStatus,
  }) {
    const fields = [
      "id",
      "name",
      "firstName",
      "lastName",
      "dateAdded",
      "status",
      "massMailOptOut",
      "clientCorporation(id,name,status)",
    ].join(",");
    const all = [];
    const pageSize = 500;
    let start = 0;
    let total = 0;
    let query;

    if (clientContactId && Number.isInteger(clientContactId)) {
      query = `id:${clientContactId}`;
    } else {
      query = `dateAdded:[${fromEpochSeconds} TO ${toEpochSeconds ?? "*"}]`;
      if (excludeStatus) {
        query += ` AND NOT status:"${excludeStatus}"`;
      }
    }

    do {
      this.logger.info(
        {
          start,
          pageSize,
          mode: clientContactId && Number.isInteger(clientContactId) ? "by-id" : "by-date-added",
          fromEpochSeconds: clientContactId && Number.isInteger(clientContactId) ? null : fromEpochSeconds,
          toEpochSeconds: clientContactId && Number.isInteger(clientContactId) ? null : (toEpochSeconds ?? null),
          clientContactId: clientContactId || null,
          excludeStatus: excludeStatus || null,
        },
        "Fetching client contact search page",
      );

      const response = await this.requestWithRetry({
        label: "search_client_contacts",
        fn: () =>
          axios.get(`${restUrl}/search/ClientContact`, {
            params: {
              BhRestToken: bhRestToken,
              query,
              fields,
              count: pageSize,
              start,
            },
          }),
      });

      const { data = [], total: reportedTotal = 0 } = response.data;
      total = reportedTotal;
      all.push(...data);
      this.logger.info(
        {
          fetchedThisPage: data.length,
          accumulatedCount: all.length,
          total,
        },
        "Fetched client contact search page",
      );
      start += data.length;
    } while (start < total);

    return all;
  }

  async getAppointment({ restUrl, bhRestToken, appointmentId }) {
    const url = `${restUrl}/entity/Appointment/${appointmentId}`;

    const response = await this.requestWithRetry({
      label: "get_appointment",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            fields: [
              "id",
              "type",
              "dateAdded",
              "candidateReference(id,firstName,lastName,name)",
              "jobOrder(id,dateAdded,employmentType,address(state),owner(id,firstName,lastName))",
            ].join(","),
          },
        }),
    });

    return response.data.data;
  }

  async getJobSubmission({ restUrl, bhRestToken, jobSubmissionId }) {
    const url = `${restUrl}/entity/JobSubmission/${jobSubmissionId}`;

    const response = await this.requestWithRetry({
      label: "get_job_submission",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            fields: [
              "id",
              "dateAdded",
              "source",
              "candidate(id,firstName,lastName,name)",
              "jobOrder(id,title,clientCorporation(id,name),owner(id,firstName,lastName,email,pager))",
            ].join(","),
          },
        }),
    });

    return response.data.data;
  }

  async queryJobSubmissionsByDateAddedRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
  }) {
    const fields = [
      "id",
      "dateAdded",
      "source",
      "candidate(id,firstName,lastName,name)",
      "jobOrder(id,title,clientCorporation(id,name),owner(id,firstName,lastName,email,pager))",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: "query_job_submissions_by_date_added_range",
        fn: () =>
          axios.get(`${restUrl}/query/JobSubmission`, {
            params: {
              BhRestToken: bhRestToken,
              where: `dateAdded>=${startMs} AND dateAdded<${endMs}`,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryJobOrdersByDateAddedRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
  }) {
    const fields = [
      "id",
      "dateAdded",
      "employmentType",
      "address(state)",
      "clientCorporation(id,name)",
      "owner(id,firstName,lastName)",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: "query_job_orders_by_date_added_range",
        fn: () =>
          axios.get(`${restUrl}/query/JobOrder`, {
            params: {
              BhRestToken: bhRestToken,
              where: `dateAdded>=${startMs} AND dateAdded<${endMs}`,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async getPlacementStatusChange({ restUrl, bhRestToken, transactionId }) {
    const url = `${restUrl}/query/PlacementEditHistory`;

    const response = await this.requestWithRetry({
      label: "get_placement_status_change",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            where: `transactionID='${transactionId}'`,
            fields: "transactionID,fieldChanges(columnName,oldValue,newValue)",
            count: 10,
          },
        }),
    });

    const records = response.data.data || [];
    for (const record of records) {
      const fieldChanges = extractFieldChanges(record.fieldChanges);
      const statusChange = fieldChanges.find(
        (change) => (change.columnName || change.fieldName) === "status",
      );
      if (statusChange) {
        return statusChange;
      }
    }

    return null;
  }

  async getClientCorporationStatusChange({ restUrl, bhRestToken, transactionId }) {
    const url = `${restUrl}/query/ClientCorporationEditHistory`;

    const response = await this.requestWithRetry({
      label: "get_client_corporation_status_change",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            where: `transactionID='${transactionId}'`,
            fields: "transactionID,fieldChanges(columnName,oldValue,newValue)",
            count: 10,
          },
        }),
    });

    const records = response.data.data || [];
    for (const record of records) {
      const fieldChanges = extractFieldChanges(record.fieldChanges);
      const statusChange = fieldChanges.find(
        (change) => (change.columnName || change.fieldName) === "status",
      );
      if (statusChange) {
        return statusChange;
      }
    }

    return null;
  }

  async queryPlacementsByDateBeginRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "dateBegin",
      "dateEnd",
      "employmentType",
      "customText8",
      "customText18",
      "customText60",
      "candidate(id,firstName,lastName)",
      "clientCorporation(id,name,customText2,customText10,customText11,customDate1,billingFrequency)",
      "billingClientContact(id,firstName,lastName,customText3,address)",
      "jobOrder(id,title,owner(id,firstName,lastName))",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: "query_placements_by_date_begin_range",
        fn: () =>
          axios.get(`${restUrl}/query/Placement`, {
            params: {
              BhRestToken: bhRestToken,
              where: `dateBegin>=${startMs} AND dateBegin<${endMs}`,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryPlacementsByDateAddedRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "dateAdded",
      "dateBegin",
      "salary",
      "flatFee",
      "owner(id,firstName,lastName,email)",
      "candidate(id,firstName,lastName,email)",
      "clientCorporation(id,name)",
      "clientContact(id,firstName,lastName,email)",
      "billingClientContact(id,firstName,lastName,email)",
      "jobOrder(id,title,owner(id,firstName,lastName,email))",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: "query_placements_by_date_added_range",
        fn: () =>
          axios.get(`${restUrl}/query/Placement`, {
            params: {
              BhRestToken: bhRestToken,
              where: `dateAdded>=${startMs} AND dateAdded<${endMs}`,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryCandidatesByDateFieldRange({
    restUrl,
    bhRestToken,
    fieldName,
    startMs,
    endMs,
    count = 200,
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "firstName",
      "lastName",
      "name",
      "email",
      fieldName,
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: "query_candidates_by_date_field_range",
        fn: () =>
          axios.get(`${restUrl}/query/Candidate`, {
            params: {
              BhRestToken: bhRestToken,
              where: `${fieldName}>=${startMs} AND ${fieldName}<${endMs}`,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryPlacementsByCandidateId({
    restUrl,
    bhRestToken,
    candidateId,
    count = 200,
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "status",
      "employmentType",
      "candidate(id,firstName,lastName,name,email)",
      "clientCorporation(id,name)",
      "jobOrder(id,title,owner(id,firstName,lastName,email,pager))",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: "query_placements_by_candidate_id",
        fn: () =>
          axios.get(`${restUrl}/query/Placement`, {
            params: {
              BhRestToken: bhRestToken,
              where: `candidate.id=${Number(candidateId)}`,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryPlacementsByDateEndRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
    maxCount = Infinity,
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "status",
      "dateBegin",
      "dateEnd",
      "employmentType",
      "candidate(id,firstName,lastName,email)",
      "clientCorporation(id,name)",
      "jobOrder(id,title,owner(id,firstName,lastName,email))",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const remaining = Math.max(maxCount - all.length, 0);
      if (remaining === 0) {
        break;
      }
      const pageSize = Math.min(count, remaining);
      const response = await this.requestWithRetry({
        label: "query_placements_by_date_end_range",
        fn: () =>
          axios.get(`${restUrl}/query/Placement`, {
            params: {
              BhRestToken: bhRestToken,
              where: `dateEnd>=${startMs} AND dateEnd<${endMs}`,
              fields,
              count: pageSize,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < pageSize) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryPlacementsWhere({
    restUrl,
    bhRestToken,
    where,
    count = 200,
    maxCount = count,
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "status",
      "dateBegin",
      "dateEnd",
      "dateLastModified",
      "employmentType",
      "candidate(id,firstName,lastName,name,email,status,address(countryName,state),dateLastComment)",
      "clientCorporation(id,name,address(countryName))",
      "jobOrder(id,title,employmentType,address(countryName,state),owner(id,firstName,lastName,email,pager))",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const remaining = Math.max(maxCount - all.length, 0);
      if (remaining === 0) {
        break;
      }
      const pageSize = Math.min(count, remaining);
      const response = await this.requestWithRetry({
        label: "query_placements_where",
        fn: () =>
          axios.get(`${restUrl}/query/Placement`, {
            params: {
              BhRestToken: bhRestToken,
              where,
              fields,
              count: pageSize,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < pageSize) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async getCandidate({ restUrl, bhRestToken, candidateId }) {
    const url = `${restUrl}/entity/Candidate/${candidateId}`;

    const response = await this.requestWithRetry({
      label: "get_candidate",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            fields: [
              "id",
              "firstName",
              "lastName",
              "email",
              "customText21",
              "dateAdded",
              "owner(id,firstName,lastName,email,primaryDepartment(name))",
            ].join(","),
          },
        }),
    });

    return response.data.data;
  }

  async getCandidateByIdWithFields({ restUrl, bhRestToken, candidateId, fields }) {
    const url = `${restUrl}/entity/Candidate/${candidateId}`;

    const response = await this.requestWithRetry({
      label: "get_candidate_by_id_with_fields",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            fields,
          },
        }),
    });

    return response.data.data;
  }

  async queryCandidateCertificationsByExpirationRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
    entityName = "CandidateCertification",
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "dateExpiration",
      "candidate(id,firstName,lastName,email,dateAdded,dateLastPlacementStarted,owner(id,firstName,lastName,email))",
    ].join(",");
    const all = [];
    let start = 0;

    while (true) {
      const response = await this.requestWithRetry({
        label: "query_candidate_certifications_by_expiration_range",
        fn: () =>
          axios.get(`${restUrl}/query/${entityName}`, {
            params: {
              BhRestToken: bhRestToken,
              where: `dateExpiration>=${startMs} AND dateExpiration<${endMs}`,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      all.push(...data);

      if (data.length < count) {
        break;
      }

      start += data.length;
    }

    return all;
  }

  async queryCandidatesByDateLastModifiedRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "firstName",
      "lastName",
      "email",
      "dateAdded",
      "dateLastModified",
      "address(countryName)",
    ].join(",");
    const all = [];
    let start = 0;
    let total = 0;
    const fromEpochSeconds = Math.floor(startMs / 1000);
    const toEpochSeconds = Math.floor(endMs / 1000);
    const query = `dateLastModified:[${fromEpochSeconds} TO ${toEpochSeconds}]`;

    do {
      const response = await this.requestWithRetry({
        label: "query_candidates_by_date_last_modified_range",
        fn: () =>
          axios.get(`${restUrl}/search/Candidate`, {
            params: {
              BhRestToken: bhRestToken,
              query,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      total = response.data.total || 0;
      all.push(...data);

      start += data.length;
    } while (start < total);

    return all;
  }

  async searchCandidatesByDateAddedRange({
    restUrl,
    bhRestToken,
    startMs,
    endMs,
    count = 200,
    fieldsOverride,
  }) {
    const fields = fieldsOverride || [
      "id",
      "firstName",
      "lastName",
      "email",
      "dateAdded",
    ].join(",");
    const all = [];
    let start = 0;
    let total = 0;
    const fromEpochSeconds = Math.floor(startMs / 1000);
    const toEpochSeconds = Math.floor(endMs / 1000);
    const query = `dateAdded:[${fromEpochSeconds} TO ${toEpochSeconds}]`;

    do {
      const response = await this.requestWithRetry({
        label: "search_candidates_by_date_added_range",
        fn: () =>
          axios.get(`${restUrl}/search/Candidate`, {
            params: {
              BhRestToken: bhRestToken,
              query,
              fields,
              count,
              start,
            },
          }),
      });

      const { data = [] } = response.data;
      total = response.data.total || 0;
      all.push(...data);
      start += data.length;
    } while (start < total);

    return all;
  }

  async getCorporateUser({ restUrl, bhRestToken, corporateUserId }) {
    const url = `${restUrl}/entity/CorporateUser/${corporateUserId}`;

    const response = await this.requestWithRetry({
      label: "get_corporate_user",
      fn: () =>
        axios.get(url, {
          params: {
            BhRestToken: bhRestToken,
            fields: "id,firstName,lastName,email,pager,primaryDepartment(name),reportToPerson(id,firstName,lastName,email)",
          },
        }),
    });

    return response.data.data;
  }

  async updateCandidate({ restUrl, bhRestToken, candidateId, patch }) {
    const url = `${restUrl}/entity/Candidate/${candidateId}`;

    await this.requestWithRetry({
      label: "update_candidate",
      fn: () =>
        axios.post(
          url,
          patch,
          { params: { BhRestToken: bhRestToken } },
        ),
    });
  }

  async createCandidateNote({ restUrl, bhRestToken, candidateId, comments }) {
    const createUrl = `${restUrl}/entity/Note`;

    const response = await this.requestWithRetry({
      label: "create_candidate_note",
      fn: () =>
        axios.put(
          createUrl,
          {
            comments,
            personReference: { id: Number(candidateId), _subtype: "Candidate" },
          },
          { params: { BhRestToken: bhRestToken } },
        ),
    });

    const locationNoteId = String(response.headers?.location || "").match(/\/Note\/(\d+)/)?.[1];
    const noteId =
      response.data?.changedEntityId ||
      response.data?.data?.changedEntityId ||
      response.data?.id ||
      response.data?.data?.id ||
      (locationNoteId ? Number(locationNoteId) : null) ||
      null;

    if (noteId) {
      await this.requestWithRetry({
        label: "create_candidate_note_entity",
        fn: () =>
          axios.put(
            `${restUrl}/entity/NoteEntity`,
            {
              note: { id: Number(noteId) },
              targetEntityID: Number(candidateId),
              targetEntityName: "User",
            },
            { params: { BhRestToken: bhRestToken } },
          ),
      });
    }

    return {
      noteId,
      response: response.data,
    };
  }

  async updateClientContact({ restUrl, bhRestToken, clientContactId, patch }) {
    const url = `${restUrl}/entity/ClientContact/${clientContactId}`;

    await this.requestWithRetry({
      label: "update_client_contact",
      fn: () =>
        axios.post(
          url,
          patch,
          { params: { BhRestToken: bhRestToken } },
        ),
    });
  }

  async updateClientCorporation({ restUrl, bhRestToken, clientCorporationId, patch }) {
    const url = `${restUrl}/entity/ClientCorporation/${clientCorporationId}`;

    await this.requestWithRetry({
      label: "update_client_corporation",
      fn: () =>
        axios.post(
          url,
          patch,
          { params: { BhRestToken: bhRestToken } },
        ),
    });
  }
}

module.exports = { BullhornClient };
