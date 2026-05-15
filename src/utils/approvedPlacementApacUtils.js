const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, normalizeString } = require("./placementStartReminderUtils");

const WORKFLOW_NAME = "approved-placement-apac-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const OLD_STATUSES = new Set(["qc approved", "pre-hire", "submitted"]);
const NEW_STATUS = "approved";
const OWNER_PAGER_VALUES = ["100", "400", "450", "460", "480", "470"];
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "approved-placement-apac.html");
const CC_EMAILS = ["apacbilling@spencer-ogden.com"];
const BCC_EMAILS = ["magdalena.krasicka@spencer-ogden.com"];

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateKeyToUtcDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(dateKey))) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return { startMs, endMs: startMs + DAY_MS, targetDate: dateKey };
}

function getBusinessDateParts({ baseDate = new Date(), timeZone = TIME_ZONE } = {}) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(baseDate)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
  };
}

function isApprovedApacStatusChange(change) {
  return OLD_STATUSES.has(normalizeLower(change?.oldValue)) && normalizeLower(change?.newValue) === NEW_STATUS;
}

function getOwner(placement) {
  return placement?.owner || placement?.jobOrder?.owner || {};
}

function getMatchDetails({ placement, statusChange }) {
  const ownerPager = normalizeString(placement?.jobOrder?.owner?.pager || getOwner(placement)?.pager);
  const employmentType = normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
  const checks = {
    statusChangeMatches: isApprovedApacStatusChange(statusChange),
    employmentTypeMatches: employmentType === "perm",
    ownerPagerMatches: OWNER_PAGER_VALUES.some((value) => ownerPager.includes(value)),
  };
  return {
    matched: Object.values(checks).every(Boolean),
    checks,
    failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key),
    actual: {
      oldStatus: statusChange?.oldValue ?? null,
      newStatus: statusChange?.newValue ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      ownerPager: ownerPager || null,
    },
    expected: {
      oldStatuses: Array.from(OLD_STATUSES),
      newStatus: NEW_STATUS,
      employmentType: "perm",
      ownerPagerContains: OWNER_PAGER_VALUES,
    },
  };
}

function matchesPlacement({ placement, statusChange }) {
  return getMatchDetails({ placement, statusChange }).matched;
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => data[key] ?? "");
}

function loadTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, "utf8");
}

function htmlToText(html) {
  return normalizeString(html)
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => normalizeString(line))
    .filter(Boolean)
    .join("\n");
}

function uniqueEmails(values, { exclude = [] } = {}) {
  const excludeSet = new Set(exclude.map(normalizeLower).filter(Boolean));
  const seen = new Set();
  const emails = [];
  for (const value of values) {
    const email = normalizeLower(value);
    if (!email || seen.has(email) || excludeSet.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

function buildTransmission({ placement }) {
  const owner = getOwner(placement);
  const toEmail = normalizeLower(owner?.email);
  const ccEmails = uniqueEmails(CC_EMAILS, { exclude: [toEmail] });
  const bccEmails = uniqueEmails(BCC_EMAILS, { exclude: [toEmail, ...ccEmails] });
  const candidateName = buildFullName(placement?.candidate);
  const html = renderTemplate(loadTemplate(), {
    owner_name: escapeHtml(buildFullName(owner) || "there"),
    placement_id: escapeHtml(placement?.id),
    candidate_name: escapeHtml(candidateName),
    client_company_name: escapeHtml(placement?.jobOrder?.clientCorporation?.name || placement?.clientCorporation?.name),
  });
  const recipients = [
    { address: { email: toEmail } },
    ...ccEmails.map((email) => ({ address: { email, header_to: toEmail } })),
    ...bccEmails.map((email) => ({ address: { email, header_to: toEmail } })),
  ].filter((recipient) => normalizeString(recipient?.address?.email));

  return {
    content: {
      from: {
        name: "Sales Operation Team",
        email: "noreply@spencer-ogden.com",
      },
      subject: `Approved placement # ${normalizeString(placement?.id)}`,
      text: htmlToText(html),
      html,
      headers: {
        ...(ccEmails.length ? { CC: ccEmails.join(", ") } : {}),
      },
    },
    recipients,
    recipientEnvelope: {
      toEmail,
      ccEmails,
      bccEmails,
      missingOwnerEmail: !toEmail,
    },
  };
}

module.exports = {
  BCC_EMAILS,
  CC_EMAILS,
  OWNER_PAGER_VALUES,
  QUERY_COUNT_DEFAULT,
  TIME_ZONE,
  WORKFLOW_NAME,
  buildTransmission,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  isApprovedApacStatusChange,
  matchesPlacement,
};
