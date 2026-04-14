const axios = require("axios");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SparkPostClient {
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
          "Retrying SparkPost API call",
        );

        await sleep(delayMs);
        attempt += 1;
      }
    }
  }

  async sendTransmission({ templateId, recipients, headers }) {
    const url = `${this.config.SPARKPOST_API_BASE_URL}/api/v1/transmissions`;
    const payload = {
      content: {
        template_id: templateId,
        ...(headers ? { headers } : {}),
      },
      recipients,
    };

    const response = await this.requestWithRetry({
      label: "sparkpost_send_transmission",
      fn: () =>
        axios.post(url, payload, {
          headers: {
            Authorization: this.config.SPARKPOST_API_KEY,
            "Content-Type": "application/json",
          },
        }),
    });

    return response.data;
  }

  async sendMessage({ from, to, subject, text, html }) {
    const url = `${this.config.SPARKPOST_API_BASE_URL}/api/v1/transmissions`;
    const payload = {
      content: {
        from,
        subject,
        text,
        html,
      },
      recipients: [{ address: { email: to } }],
    };

    const response = await this.requestWithRetry({
      label: "sparkpost_send_message",
      fn: () =>
        axios.post(url, payload, {
          headers: {
            Authorization: this.config.SPARKPOST_API_KEY,
            "Content-Type": "application/json",
          },
        }),
    });

    return response.data;
  }

  async getTemplate(templateId) {
    const url = `${this.config.SPARKPOST_API_BASE_URL}/api/v1/templates/${templateId}`;

    const response = await this.requestWithRetry({
      label: "sparkpost_get_template",
      fn: () =>
        axios.get(url, {
          headers: {
            Authorization: this.config.SPARKPOST_API_KEY,
            "Content-Type": "application/json",
          },
        }),
    });

    return response.data;
  }
}

module.exports = { SparkPostClient };
