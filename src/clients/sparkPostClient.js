const axios = require("axios");
const { insertWorkflowEmailTransmissionPostgres } = require("../stores/postgresWorkflowEmailTransmissionStore");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getRecipientEmail(recipient) {
  return normalizeEmail(recipient?.address?.email);
}

function getPrimaryRecipientEmail(recipients = []) {
  for (const recipient of recipients) {
    const email = getRecipientEmail(recipient);
    if (email) {
      return email;
    }
  }

  return "";
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

  async sendTransmission({ templateId, recipients, headers, attachments, from, audit }) {
    const url = `${this.config.SPARKPOST_API_BASE_URL}/api/v1/transmissions`;
    const finalRecipients = this.appendBullhornTrackingRecipient(recipients);
    const payload = {
      content: {
        template_id: templateId,
        ...(from ? { from } : {}),
        ...(headers ? { headers } : {}),
        ...(attachments?.length ? { attachments } : {}),
      },
      recipients: finalRecipients,
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

    await this.recordEmailTransmission({
      sendMethod: "template",
      payload,
      audit,
      providerResponse: response.data,
    });

    return response.data;
  }

  async sendInlineTransmission({ content, recipients, tracking, audit }) {
    const url = `${this.config.SPARKPOST_API_BASE_URL}/api/v1/transmissions`;
    const finalRecipients = this.appendBullhornTrackingRecipient(recipients);
    const payload = {
      content,
      recipients: finalRecipients,
    };

    const response = await this.requestWithRetry({
      label: "sparkpost_send_inline_transmission",
      fn: () =>
        axios.post(url, payload, {
          headers: {
            Authorization: this.config.SPARKPOST_API_KEY,
            "Content-Type": "application/json",
          },
        }),
    });

    await this.recordEmailTransmission({
      sendMethod: "inline",
      payload,
      tracking,
      audit,
      providerResponse: response.data,
    });

    return response.data;
  }

  async sendMessage({ from, to, subject, text, html, audit }) {
    const url = `${this.config.SPARKPOST_API_BASE_URL}/api/v1/transmissions`;
    const recipients = this.appendBullhornTrackingRecipient([{ address: { email: to } }]);
    const payload = {
      content: {
        from,
        subject,
        text,
        html,
      },
      recipients,
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

    await this.recordEmailTransmission({
      sendMethod: "message",
      payload,
      audit,
      providerResponse: response.data,
    });

    return response.data;
  }

  appendBullhornTrackingRecipient(recipients = []) {
    const trackingEmail = normalizeEmail(this.config.BULLHORN_EMAIL_TRACKING_BCC);
    if (!trackingEmail) {
      return recipients;
    }

    const primaryEmail = getPrimaryRecipientEmail(recipients);
    if (!primaryEmail) {
      return recipients;
    }

    if (recipients.some((recipient) => getRecipientEmail(recipient) === trackingEmail)) {
      return recipients;
    }

    return [
      ...recipients,
      {
        address: {
          email: trackingEmail,
          header_to: primaryEmail,
        },
      },
    ];
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

  async recordEmailTransmission({ sendMethod, payload, tracking, audit, providerResponse }) {
    try {
      await insertWorkflowEmailTransmissionPostgres({
        config: this.config,
        transmission: {
          environment: String(this.config.BULLHORN_ENV || "production").trim().toLowerCase(),
          provider: "sparkpost",
          sendMethod,
          payload,
          tracking,
          audit,
          providerResponse,
          sentAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      this.logger.warn(
        {
          sendMethod,
          message: error.message,
        },
        "Failed to write email transmission record to PostgreSQL",
      );
    }
  }
}

module.exports = { SparkPostClient };
