const fs = require("node:fs");
const path = require("node:path");

const { buildFullName, formatDateBegin, normalizeString } = require("./placementStartReminderUtils");
const { getPlacementCountry, getPlacementWorkState } = require("./harassmentTrainingUtils");

const TERMINATION_TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_END_STATUSES = new Set(["completed", "terminated"]);
const DATE_END_MINIMUM = "2023-01-01";
const TERMINATION_REASONS = new Set([
  "attendance",
  "completed project",
  "converted by client",
  "failed fce",
  "job abandonment",
  "lack of work",
  "misconduct",
  "performance",
  "personal reasons",
  "promotion",
  "resigned due to client environment",
  "resigned other job",
]);
const APAC_PERM_DEPARTMENTS = new Set([
  "singapore",
  "malaysia",
  "perth",
  "per - perm mining",
  "per - contract engineering",
  "per - contract power & nuclear",
  "per - perm o&g",
  "sin - renewables",
  "sin - field services",
  "sin - contract p&n",
  "sin - production and chemicals",
  "hon - construction and property",
  "hon - contract o&g",
  "hong kong",
  "hon - perm finance",
  "hon - perm et",
  "mel - perm built environment",
  "mel - contract renewables",
  "mel - perm renewables",
]);
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");

let templateCache = new Map();

const WORKFLOW_RULES = [
  {
    key: "alabama-termination-notice",
    source: "dateEnd",
    states: ["alabama"],
    employmentType: "contract",
    statusIn: DATE_END_STATUSES,
    dateEndOffsetDays: 0,
    weekendAdjust: true,
    sendAtPacificHour: 9,
    from: { name: "Spencer Ogden Onboarding", email: "onboarding@spencer-ogden.com" },
    to: "candidate.email",
    cc: ["usapayrollqueries@spencer-ogden.com"],
    subject: "State of Alabama Termination Notice -Unemployment benefits at the time of separation",
    attachments: ["attachments/Alabama UI Notice.docs", "attachments/Alabama UI Notice.docx"],
    templatePath: "termination-alabama-notice.html",
  },
  {
    key: "colorado-termination",
    source: "statusChange",
    states: ["colorado"],
    country: "united states",
    employmentType: "contract",
    newStatusIn: new Set(["terminated", "completed"]),
    weekendAdjust: true,
    to: "candidateOwner.email",
    cc: ["usapayrollqueries@spencer-ogden.com"],
    subject: "State of Colorado Termination Notice required for your recent contractor exit",
    attachments: ["attachments/Notice of potential availability of unemployment insurance benefits.pdf"],
    templatePath: "termination-colorado.html",
  },
  {
    key: "georgia-termination",
    source: "statusChange",
    states: ["georgia"],
    employmentType: "contract",
    newStatusIn: new Set(["terminated", "completed"]),
    weekendAdjust: true,
    to: "candidateOwner.email",
    cc: ["usapayrollqueries@spencer-ogden.com"],
    subject: "State of Georgia Termination Notice required for your recent contractor exit",
    templatePath: "termination-georgia.html",
  },
  ...["pennsylvania", "connecticut"].map((state) => ({
    key: `${state}-termination-notice`,
    source: "dateEnd",
    states: [state],
    employmentType: "contract",
    statusIn: DATE_END_STATUSES,
    dateEndOffsetDays: 0,
    weekendAdjust: true,
    sendAtPacificHour: 9,
    from: { name: "Spencer Ogden Onboarding", email: "onboarding@spencer-ogden.com" },
    to: "candidate.email",
    cc: ["usapayrollqueries@spencer-ogden.com"],
    subject: `State of ${state === "pennsylvania" ? "Pennsylvania" : "Connecticut"} Termination Notice`,
    attachments: state === "pennsylvania" ? ["attachments/Unemployment Notice to Employees.pdf"] : [],
    templatePath: "termination-generic-unemployment-notice.html",
  })),
  {
    key: "tennessee-termination-notice",
    source: "dateEnd",
    states: ["tennessee"],
    employmentType: "contract",
    statusIn: DATE_END_STATUSES,
    dateEndOffsetDays: 1,
    weekendAdjust: true,
    sendAtPacificHour: 9,
    from: { name: "Spencer Ogden Onboarding", email: "onboarding@spencer-ogden.com" },
    to: "candidate.email",
    cc: ["usapayrollqueries@spencer-ogden.com"],
    subject: "State of Tennessee Termination Notice",
    templatePath: "termination-generic-unemployment-notice.html",
  },
  {
    key: "maryland-termination",
    source: "statusChange",
    states: ["maryland"],
    employmentType: "contract",
    oldStatusIn: new Set(["approved", "qc approved", "completed"]),
    newStatusIn: new Set(["terminated"]),
    delayDays: 1,
    weekendAdjust: true,
    from: "candidateOwner",
    to: "candidate.email",
    cc: ["onboarding@spencer-ogden.com"],
    subject: "State of Maryland Termination Notice",
    attachments: ["attachments/Unemployment Notice.pdf", "attachments/Unemployment NOtice.pdf"],
    templatePath: "termination-maryland.html",
  },
  ...["new york", "wyoming"].map((state) => ({
    key: `${state.replace(/\s+/g, "-")}-termination`,
    source: "terminationReasonChange",
    states: [state],
    employmentType: "contract",
    terminationReasons: TERMINATION_REASONS,
    delayDays: 1,
    weekendAdjust: true,
    from: { name: "Spencer Ogden Onboarding", email: "onboarding@spencer-ogden.com" },
    to: "candidate.email",
    cc: [],
    subject: `State of ${state === "new york" ? "New York" : "Wyoming"} Termination Notice`,
    attachments: state === "wyoming" ? ["attachments/WY UI Notice to Employees 2020-04-23 11_46.pdf"] : [],
    templatePath: "termination-generic-unemployment-notice.html",
  })),
  {
    key: "california-change-in-relationship",
    source: "terminationReasonChange",
    states: ["california"],
    employmentType: "contract",
    terminationReasons: TERMINATION_REASONS,
    delayDays: 1,
    weekendAdjust: true,
    from: "candidateOwner",
    to: "candidate.email",
    cc: [],
    subject: "Notice to employee of change in relationship",
    attachments: ["attachments/For Your Benefit_ California's Programs for the Unemployed (DE 2320 Rev. 64 (11-19)).pdf"],
    templatePath: "termination-california-change-in-relationship.html",
  },
  {
    key: "new-jersey-unemployment-benefits",
    source: "terminationReasonChange",
    states: ["new jersey"],
    employmentType: "contract",
    terminationReasons: TERMINATION_REASONS,
    delayDays: 1,
    weekendAdjust: true,
    from: "candidateOwner",
    to: "candidate.email",
    cc: [],
    subject: "Information regarding unemployment benefits",
    templatePath: "termination-new-jersey-unemployment-benefits.html",
  },
  {
    key: "apac-perm-termination-invoicing",
    source: "statusChange",
    employmentType: "perm",
    ownerDepartmentIn: APAC_PERM_DEPARTMENTS,
    oldStatusIn: new Set(["approved", "qc approved"]),
    newStatusIn: new Set(["terminated"]),
    delayDays: 1,
    weekendAdjust: false,
    from: "owner",
    to: "owner.email",
    cc: [],
    subject: "APAC Perm Termination - Invoicing",
    attachments: ["attachments/APAC Termination process.png"],
    templatePath: "termination-apac-perm-invoicing.html",
  },
  {
    key: "end-of-month-contract-reminder",
    source: "dateEnd",
    employmentType: "contract",
    country: "united states",
    statusIn: new Set(["qc approved", "approved", "completed"]),
    dateEndReminderOffsets: [4, 3, 2],
    weekendAdjust: false,
    sendAtPacificHour: 9,
    from: { name: "SO Benefits Team", email: "onboarding@spencer-ogden.com" },
    to: "jobOrderOwner.email",
    cc: ["owner.reportToPerson.email", "onboarding@spencer-ogden.com"],
    subject: "Contract ending soon - action required",
    templatePath: "termination-end-of-month-contract-reminder.html",
  },
  {
    key: "us-perm-termination-invoice",
    source: "statusChange",
    employmentType: "perm",
    ownerDepartmentIn: APAC_PERM_DEPARTMENTS,
    oldStatusIn: new Set(["qc approved", "approved"]),
    newStatusIn: new Set(["terminated"]),
    delayHours: 1,
    weekendAdjust: false,
    from: { name: "Spencer Ogden", email: "onboarding@spencer-ogden.com" },
    to: "owner.email",
    cc: ["usainvoices@spencer-ogden.com", "onboarding@spencer-ogden.com"],
    subject: "Perm Termination - Invoice",
    attachments: ["attachments/USA Termination process.png"],
    templatePath: "termination-us-perm-invoice.html",
  },
];

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function validateDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(value))) {
    throw new Error(`Invalid date key: ${value}`);
  }
}

function dateKeyToUtcDate(dateKey) {
  validateDateKey(dateKey);
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function getBusinessDateParts({ baseDate = new Date(), timeZone = TERMINATION_TIME_ZONE } = {}) {
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
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
  };
}

function getDayOfWeek(dateKey) {
  return dateKeyToUtcDate(dateKey).getUTCDay();
}

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return { startMs, endMs: startMs + DAY_MS, targetDate: dateKey };
}

function buildSendDateKeysForWeekendAdjust({ businessDateKey, weekendAdjust }) {
  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (!weekendAdjust) return [businessDateKey];
  if (dayOfWeek === 5) return [businessDateKey, addDays(businessDateKey, 1)];
  if (dayOfWeek === 1) return [addDays(businessDateKey, -1), businessDateKey];
  if (dayOfWeek === 0 || dayOfWeek === 6) return [];
  return [businessDateKey];
}

function buildDelayedChangeDateKeys({ businessDateKey, delayDays = 0, weekendAdjust }) {
  if (!delayDays) {
    const dayOfWeek = getDayOfWeek(businessDateKey);
    if (weekendAdjust && dayOfWeek === 1) {
      return [addDays(businessDateKey, -2), addDays(businessDateKey, -1), businessDateKey];
    }
    if (weekendAdjust && (dayOfWeek === 0 || dayOfWeek === 6)) return [];
    return [businessDateKey];
  }

  const dayOfWeek = getDayOfWeek(businessDateKey);
  if (!weekendAdjust) return [addDays(businessDateKey, -delayDays)];
  if (dayOfWeek === 1) return [addDays(businessDateKey, -3), addDays(businessDateKey, -2), addDays(businessDateKey, -1)];
  if (dayOfWeek === 5) return [addDays(businessDateKey, -1), businessDateKey];
  if (dayOfWeek === 0 || dayOfWeek === 6) return [];
  return [addDays(businessDateKey, -delayDays)];
}

function buildDateEndQueryDates({ rule, businessDateKey }) {
  if (rule.dateEndReminderOffsets) {
    return rule.dateEndReminderOffsets.map((offset) => addDays(businessDateKey, offset));
  }

  return buildSendDateKeysForWeekendAdjust({
    businessDateKey,
    weekendAdjust: rule.weekendAdjust,
  }).map((sendDateKey) => addDays(sendDateKey, -(rule.dateEndOffsetDays || 0)));
}

function extractFieldChanges(fieldChanges) {
  if (Array.isArray(fieldChanges)) return fieldChanges;
  if (Array.isArray(fieldChanges?.data)) return fieldChanges.data;
  return [];
}

function findFieldChange(record, names) {
  const nameSet = new Set(names.map((name) => normalizeLower(name)));
  return extractFieldChanges(record?.fieldChanges).find((change) =>
    nameSet.has(normalizeLower(change.columnName || change.fieldName)),
  ) || null;
}

function getTransactionId(record) {
  return record?.transactionID || record?.transactionId || null;
}

function isTimedRuleDue({ rule, businessHour, force = false }) {
  return force || rule.sendAtPacificHour === undefined || Number(rule.sendAtPacificHour) === businessHour;
}

function getEmploymentType(placement) {
  return normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
}

function getCandidateOwner(placement) {
  return placement?.candidate?.owner || {};
}

function getOwner(placement) {
  return placement?.owner || placement?.jobOrder?.owner || {};
}

function getJobOrderOwner(placement) {
  return placement?.jobOrder?.owner || {};
}

function resolvePathValue(placement, selector) {
  const candidateOwner = getCandidateOwner(placement);
  const owner = getOwner(placement);
  const jobOrderOwner = getJobOrderOwner(placement);
  const values = {
    "candidate.email": placement?.candidate?.email,
    "candidateOwner.email": candidateOwner.email,
    "owner.email": owner.email,
    "jobOrderOwner.email": jobOrderOwner.email,
    "owner.reportToPerson.email": owner?.reportToPerson?.email,
  };
  return normalizeLower(values[selector]);
}

function resolveEmailValue(placement, value) {
  const normalized = normalizeString(value);
  if (normalized.includes("@")) {
    return normalizeLower(normalized);
  }
  return resolvePathValue(placement, normalized);
}

function uniqueEmails(values, { exclude = [] } = {}) {
  const excludeSet = new Set(exclude.map((value) => normalizeLower(value)).filter(Boolean));
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

function loadHtmlTemplate(templatePath) {
  const resolvedPath = path.join(TEMPLATE_DIR, templatePath);
  if (!templateCache.has(resolvedPath)) {
    templateCache.set(resolvedPath, fs.readFileSync(resolvedPath, "utf8"));
  }
  return templateCache.get(resolvedPath);
}

function renderTemplate(template, placement) {
  const candidateOwner = getCandidateOwner(placement);
  const values = {
    id: normalizeString(placement?.id),
    "candidate.firstname": normalizeString(placement?.candidate?.firstName),
    "candidate.firstName": normalizeString(placement?.candidate?.firstName),
    "candidate.lastname": normalizeString(placement?.candidate?.lastName),
    "candidate.lastName": normalizeString(placement?.candidate?.lastName),
    "candidateOwner.firstname": normalizeString(candidateOwner?.firstName),
    "candidateowner.firstname": normalizeString(candidateOwner?.firstName),
    "candidateOwner.name": buildFullName(candidateOwner),
    "candidateowner.name": buildFullName(candidateOwner),
    "dateend": formatDateBegin(placement?.dateEnd),
    "workState": normalizeString(getPlacementWorkState(placement)),
    "workstate": normalizeString(getPlacementWorkState(placement)),
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => values[key] ?? match);
}

function htmlToText(html) {
  return normalizeString(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
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

function matchesCommonRule(placement, rule) {
  const state = normalizeLower(getPlacementWorkState(placement));
  const country = normalizeLower(getPlacementCountry(placement));
  const employmentType = getEmploymentType(placement);
  const status = normalizeLower(placement?.status);
  const department = normalizeLower(getOwner(placement)?.primaryDepartment?.name);

  if (rule.states && !rule.states.includes(state)) return false;
  if (rule.country && country !== rule.country) return false;
  if (rule.employmentType && employmentType !== rule.employmentType) return false;
  if (rule.statusIn && !rule.statusIn.has(status)) return false;
  if (rule.ownerDepartmentIn && !rule.ownerDepartmentIn.has(department)) return false;
  if (rule.key === "end-of-month-contract-reminder") {
    const dateEnd = new Date(placement?.dateEnd);
    if (Number.isNaN(dateEnd.getTime()) || dateEnd <= dateKeyToUtcDate(DATE_END_MINIMUM)) return false;
  }
  return true;
}

function setToArray(value) {
  return value ? Array.from(value) : null;
}

function getRuleMatchDetails({ placement, rule, change = null } = {}) {
  const state = normalizeLower(getPlacementWorkState(placement));
  const country = normalizeLower(getPlacementCountry(placement));
  const employmentType = getEmploymentType(placement);
  const status = normalizeLower(placement?.status);
  const department = normalizeLower(getOwner(placement)?.primaryDepartment?.name);
  const oldValue = normalizeLower(change?.oldValue);
  const newValue = normalizeLower(change?.newValue);
  const dateEnd = new Date(placement?.dateEnd);
  const dateEndAfterMinimum =
    !Number.isNaN(dateEnd.getTime()) && dateEnd > dateKeyToUtcDate(DATE_END_MINIMUM);
  const checks = {
    stateMatches: !rule.states || rule.states.includes(state),
    countryMatches: !rule.country || country === rule.country,
    employmentTypeMatches: !rule.employmentType || employmentType === rule.employmentType,
    statusMatches: !rule.statusIn || rule.statusIn.has(status),
    ownerDepartmentMatches: !rule.ownerDepartmentIn || rule.ownerDepartmentIn.has(department),
    dateEndAfterMinimum:
      rule.key !== "end-of-month-contract-reminder" || dateEndAfterMinimum,
    oldStatusMatches: !rule.oldStatusIn || rule.oldStatusIn.has(oldValue),
    newStatusMatches: !rule.newStatusIn || rule.newStatusIn.has(newValue),
    terminationReasonMatches: !rule.terminationReasons || rule.terminationReasons.has(newValue),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      state: getPlacementWorkState(placement) || null,
      country: getPlacementCountry(placement) || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      status: placement?.status || null,
      ownerDepartment: getOwner(placement)?.primaryDepartment?.name || null,
      dateEnd: placement?.dateEnd ?? null,
      oldValue: change?.oldValue ?? null,
      newValue: change?.newValue ?? null,
    },
    expected: {
      states: rule.states || null,
      country: rule.country || null,
      employmentType: rule.employmentType || null,
      statusIn: setToArray(rule.statusIn),
      ownerDepartmentIn: setToArray(rule.ownerDepartmentIn),
      dateEndAfter: rule.key === "end-of-month-contract-reminder" ? DATE_END_MINIMUM : null,
      oldStatusIn: setToArray(rule.oldStatusIn),
      newStatusIn: setToArray(rule.newStatusIn),
      terminationReasons: setToArray(rule.terminationReasons),
    },
  };
}

function matchesChangeRule({ placement, rule, change }) {
  return getRuleMatchDetails({ placement, rule, change }).matched;
}

function findAttachmentPath(candidates) {
  for (const candidate of candidates || []) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function buildAttachment(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const typeByExt = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
  };
  return {
    name: path.basename(filePath),
    type: typeByExt[ext] || "application/octet-stream",
    data: fs.readFileSync(filePath).toString("base64"),
  };
}

function resolveFrom({ placement, rule }) {
  if (rule.from === "candidateOwner") {
    const owner = getCandidateOwner(placement);
    return { name: buildFullName(owner) || "Spencer Ogden", email: normalizeLower(owner.email) };
  }
  if (rule.from === "owner") {
    const owner = getOwner(placement);
    return { name: buildFullName(owner) || "Spencer Ogden", email: normalizeLower(owner.email) };
  }
  return rule.from || { name: "Spencer Ogden", email: "onboarding@spencer-ogden.com" };
}

function buildInlineTransmission({ placement, rule, attachments = [] }) {
  const toEmail = resolvePathValue(placement, rule.to);
  const ccEmails = uniqueEmails((rule.cc || []).map((selector) => resolveEmailValue(placement, selector)), { exclude: [toEmail] });
  const html = renderTemplate(loadHtmlTemplate(rule.templatePath), placement);
  const recipients = [
    { address: { email: toEmail } },
    ...ccEmails.map((email) => ({ address: { email, header_to: toEmail } })),
  ].filter((recipient) => normalizeString(recipient?.address?.email));

  return {
    content: {
      from: resolveFrom({ placement, rule }),
      subject: rule.subject,
      text: htmlToText(html),
      html,
      ...(ccEmails.length ? { headers: { CC: ccEmails.join(", ") } } : {}),
      ...(attachments.length ? { attachments } : {}),
    },
    recipients,
    recipientEnvelope: {
      toEmail,
      ccEmails,
      missingToEmail: !toEmail,
    },
  };
}

function buildReportRecord({ placement, rule, source, queryDate, change = null, transactionId = null, transmission, attachmentPaths, sendLock }) {
  return {
    placementId: placement?.id ?? null,
    ruleKey: rule.key,
    source,
    queryDate,
    transactionId,
    change: change ? { oldValue: change.oldValue ?? null, newValue: change.newValue ?? null } : null,
    sendLock,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      dateEnd: placement?.dateEnd || null,
      dateEndFormatted: formatDateBegin(placement?.dateEnd) || null,
      workState: getPlacementWorkState(placement) || null,
      country: getPlacementCountry(placement) || null,
      candidate: placement?.candidate || null,
      owner: getOwner(placement) || null,
      jobOrder: placement?.jobOrder || null,
    },
    recipient: transmission.recipientEnvelope,
    attachmentPaths,
    sparkPostPayload: {
      content: {
        ...transmission.content,
        attachments: attachmentsForReport(transmission.content.attachments),
      },
      recipients: transmission.recipients,
    },
  };
}

function attachmentsForReport(attachments = []) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    data: "[base64 omitted]",
  }));
}

module.exports = {
  TERMINATION_TIME_ZONE,
  WORKFLOW_RULES,
  buildDateEndQueryDates,
  buildDelayedChangeDateKeys,
  buildInlineTransmission,
  buildReportRecord,
  buildUtcDayWindowFromDateKey,
  findAttachmentPath,
  findFieldChange,
  getBusinessDateParts,
  getTransactionId,
  isTimedRuleDue,
  getRuleMatchDetails,
  matchesChangeRule,
  matchesCommonRule,
  normalizeLower,
  buildAttachment,
};
