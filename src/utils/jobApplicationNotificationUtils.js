const fs = require("node:fs");
const path = require("node:path");

const {
  buildFullName,
  normalizeString,
} = require("./placementStartReminderUtils");

const DEFAULT_APPLICATION_SOURCES = [
  "spencer ogden 2021",
  "adzuna",
  "cv library",
  "glassdoor",
  "indeed",
  "spencer ogden",
  "spencer ogden website",
  "linkedin premium",
  "linkedin",
  "linkedin recruiter",
  "linkedin recruiter license",
  "linked in",
  "epc engineer",
  "jobrapido",
];

const DEFAULT_OWNER_PAGERS = ["500"];
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const TEMPLATE_PATH = "job-application-notification.html";

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeList(value, fallback) {
  if (Array.isArray(value)) {
    return value.map(normalizeLower).filter(Boolean);
  }

  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback.map(normalizeLower);
  }

  return normalized
    .split(",")
    .map(normalizeLower)
    .filter(Boolean);
}

function parseIsoDateToUtcMs(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getTime();
}

function getCandidateName(candidate) {
  return normalizeString(candidate?.name) || buildFullName(candidate);
}

function getApplicationSource(jobSubmission) {
  return normalizeString(jobSubmission?.source);
}

function isOnOrAfterIsoDate(value, cutoffDate) {
  const cutoffMs = parseIsoDateToUtcMs(cutoffDate);
  if (cutoffMs === null) {
    return true;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() >= cutoffMs;
}

function getJobApplicationNotificationMatchDetails({ jobSubmission, owner, config = {} }) {
  const source = getApplicationSource(jobSubmission);
  const allowedSources = normalizeList(
    config.JOB_APPLICATION_NOTIFICATION_SOURCES,
    DEFAULT_APPLICATION_SOURCES,
  );
  const allowedPagers = normalizeList(
    config.JOB_APPLICATION_NOTIFICATION_OWNER_PAGERS,
    DEFAULT_OWNER_PAGERS,
  );

  const jobOrderOwner = owner || jobSubmission?.jobOrder?.owner || {};
  const sourceMatches = allowedSources.includes(normalizeLower(source));
  const ownerPagerMatches = allowedPagers.includes(normalizeLower(jobOrderOwner?.pager));
  const matches = sourceMatches && ownerPagerMatches;

  return {
    matches,
    matchedRule: matches ? "applications-from-all-job-boards" : null,
    source,
    sourceMatches,
    ownerPagerMatches,
    ownerPager: jobOrderOwner?.pager || null,
    allowedSources,
    allowedPagers,
  };
}

function buildSubject(jobSubmission) {
  return `New Application for Job: ${normalizeString(jobSubmission?.jobOrder?.id)} - ${normalizeString(jobSubmission?.jobOrder?.title)}`;
}

function buildTextBody({ jobSubmission, owner }) {
  const jobOrder = jobSubmission?.jobOrder || {};
  const candidate = jobSubmission?.candidate || {};
  const ownerFirstName = normalizeString(owner?.firstName || jobOrder?.owner?.firstName);

  return [
    `Hi ${ownerFirstName},`,
    "",
    `With regards to your Job ID: ${normalizeString(jobOrder.id)} - ${normalizeString(jobOrder.title)} at company: `,
    `${normalizeString(jobOrder?.clientCorporation?.name)}, please note that a new application has been received from the following job board:`,
    "",
    `Source: ${getApplicationSource(jobSubmission)}`,
    " ",
    "The details of the candidate shortlisted is below:",
    "",
    `ID: ${normalizeString(candidate.id)}`,
    `Name: ${getCandidateName(candidate)}`,
    "",
    "Please review this application.",
    "",
    "Kind Regards,",
    "Sales Operations Team",
  ].join("\n");
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadTemplate() {
  return fs.readFileSync(path.join(TEMPLATE_DIR, TEMPLATE_PATH), "utf8");
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
}

function buildThemedHtmlBody({ jobSubmission, owner }) {
  const jobOrder = jobSubmission?.jobOrder || {};
  const candidate = jobSubmission?.candidate || {};

  return renderTemplate(loadTemplate(), {
    owner_first_name: escapeHtml(owner?.firstName || jobOrder?.owner?.firstName),
    job_order_id: escapeHtml(jobOrder.id),
    job_order_title: escapeHtml(jobOrder.title),
    client_corporation_name: escapeHtml(jobOrder?.clientCorporation?.name),
    source: escapeHtml(getApplicationSource(jobSubmission)),
    candidate_id: escapeHtml(candidate.id),
    candidate_name: escapeHtml(getCandidateName(candidate)),
  });
}

function buildInlineEmailContent({ jobSubmission, owner }) {
  const text = buildTextBody({ jobSubmission, owner });

  return {
    from: {
      name: "Sales Operations Team",
      email: "noreply@spencer-ogden.com",
    },
    subject: buildSubject(jobSubmission),
    text,
    html: buildThemedHtmlBody({ jobSubmission, owner }),
  };
}

function buildJobApplicationRecipient({ recipientEmail, jobSubmission, owner, matchedRule }) {
  const candidate = jobSubmission?.candidate || {};
  const jobOrder = jobSubmission?.jobOrder || {};

  return {
    address: {
      email: recipientEmail,
    },
    substitution_data: {
      job_submission_id: normalizeString(jobSubmission?.id),
      matched_rule: matchedRule || "",
      source: getApplicationSource(jobSubmission),
      job_order_id: normalizeString(jobOrder.id),
      job_order_title: normalizeString(jobOrder.title),
      client_corporation_id: normalizeString(jobOrder?.clientCorporation?.id),
      client_corporation_name: normalizeString(jobOrder?.clientCorporation?.name),
      candidate_id: normalizeString(candidate.id),
      candidate_name: getCandidateName(candidate),
      owner_id: normalizeString(owner?.id || jobOrder?.owner?.id),
      owner_first_name: normalizeString(owner?.firstName || jobOrder?.owner?.firstName),
      owner_email: normalizeString(recipientEmail),
    },
  };
}

module.exports = {
  DEFAULT_APPLICATION_SOURCES,
  DEFAULT_OWNER_PAGERS,
  buildInlineEmailContent,
  buildJobApplicationRecipient,
  buildSubject,
  buildThemedHtmlBody,
  buildTextBody,
  getApplicationSource,
  getCandidateName,
  getJobApplicationNotificationMatchDetails,
  isOnOrAfterIsoDate,
  loadTemplate,
  normalizeList,
  renderTemplate,
};
