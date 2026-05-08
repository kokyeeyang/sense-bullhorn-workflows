const fs = require("node:fs");
const path = require("node:path");

const { getPlacementCountry } = require("./harassmentTrainingUtils");
const { buildFullName, formatDateBegin, normalizeString } = require("./placementStartReminderUtils");

const WORKFLOW_NAME = "americas-internal-placement-notices-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const SKIPPED_PREVIEW_LIMIT = 25;

const TEMPLATE_IMAGE_CIDS = {
  checklistContractTop: "checklist-contract-top.png",
  checklistContractBottom: "checklist-contract-bottom.jpeg",
  checklistPerm: "checklist-perm.jpeg",
};

const RULES = [
  {
    key: "americas-perm-checkin-missing",
    source: "dateBegin",
    sendDayOffset: 2,
    weekendPolicy: "nearest-weekday",
    sendAtPacificHour: 10,
    country: "united states",
    employmentType: "perm",
    statusIn: new Set(["qc approved"]),
    from: {
      name: "Onboarding",
      email: "onboarding@spencer-ogden.com",
    },
    to: "owner.email",
    cc: [],
    subject: "Perm check-in (Missing)",
    templateVariant: "perm-checkin-missing",
  },
  {
    key: "americas-deal-being-reviewed",
    source: "statusChange",
    weekendPolicy: "send-anyway",
    country: "united states",
    employmentType: null,
    statusIn: new Set(["submitted"]),
    oldStatusIn: new Set(["pre-hire"]),
    newStatusIn: new Set(["submitted"]),
    from: {
      name: "Compliance and Contractor Services",
      email: "onboarding@spencer-ogden.com",
    },
    to: "owner.email",
    cc: [],
    subject: "Your placement is in QC Review",
    templateVariant: "deal-being-reviewed",
  },
  {
    key: "americas-perm-confirm-scheduled-start",
    source: "dateBegin",
    sendDayOffset: -4,
    weekendPolicy: "send-anyway",
    sendAtPacificHour: 9,
    country: "united states",
    employmentType: "perm",
    statusIn: new Set(["qc approved"]),
    from: {
      name: "Compliance and Contractor Services",
      email: "onboarding@spencer-ogden.com",
    },
    to: "owner.email",
    cc: ["onboarding@spencer-ogden.com"],
    subject: "Please confirm start date has not changed",
    templateVariant: "perm-confirm-scheduled-start",
  },
  {
    key: "americas-placement-checklist-contract",
    source: "statusChange",
    weekendPolicy: "send-anyway",
    country: "united states",
    employmentType: "contract",
    statusIn: new Set(["pre-hire"]),
    newStatusIn: new Set(["pre-hire"]),
    from: {
      name: "Compliance and Contractor Services",
      email: "onboarding@spencer-ogden.com",
    },
    to: "owner.email",
    cc: [],
    subject: "Placement Checklist for QC",
    templateVariant: "placement-checklist-contract",
    inlineImagePaths: [
      "attachments/04feba1af491448b9cb336d141957544.png",
      "attachments/fb56e2f58fc1422eaede896f193ca726.jpeg",
    ],
  },
  {
    key: "americas-placement-checklist-perm",
    source: "statusChange",
    weekendPolicy: "send-anyway",
    country: "united states",
    employmentType: "perm",
    statusIn: new Set(["pre-hire"]),
    newStatusIn: new Set(["pre-hire"]),
    from: {
      name: "Compliance and Contractor Services",
      email: "onboarding@spencer-ogden.com",
    },
    to: "owner.email",
    cc: [],
    subject: "Placement Checklist for QC",
    templateVariant: "placement-checklist-perm",
    inlineImagePaths: ["attachments/21b4c0df14d34d0a83360343ad6f56b9.jpeg"],
  },
];

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function dateKeyToUtcDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(dateKey))) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function getDayOfWeek(dateKey) {
  return dateKeyToUtcDate(dateKey).getUTCDay();
}

function adjustWeekendDate(dateKey, weekendPolicy) {
  if (weekendPolicy !== "nearest-weekday") {
    return dateKey;
  }

  const dayOfWeek = getDayOfWeek(dateKey);
  if (dayOfWeek === 6) {
    return addDays(dateKey, -1);
  }
  if (dayOfWeek === 0) {
    return addDays(dateKey, 1);
  }
  return dateKey;
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

function buildUtcDayWindowFromDateKey(dateKey) {
  const startMs = dateKeyToUtcDate(dateKey).getTime();
  return {
    startMs,
    endMs: startMs + DAY_MS,
    targetDate: dateKey,
  };
}

function buildDateBeginQueryDates({ rule, businessDateKey }) {
  const baseDateBegin = addDays(businessDateKey, -rule.sendDayOffset);
  if (rule.weekendPolicy !== "nearest-weekday") {
    return [baseDateBegin];
  }

  const matches = [];
  for (let delta = -2; delta <= 2; delta += 1) {
    const candidateDateBegin = addDays(baseDateBegin, delta);
    const nominalSendDate = addDays(candidateDateBegin, rule.sendDayOffset);
    const adjustedSendDate = adjustWeekendDate(nominalSendDate, rule.weekendPolicy);
    if (adjustedSendDate === businessDateKey) {
      matches.push(candidateDateBegin);
    }
  }

  return Array.from(new Set(matches));
}

function buildStatusChangeQueryDates({ businessDateKey }) {
  return [businessDateKey];
}

function isTimedRuleDue({ rule, businessHour, force = false }) {
  return force || rule.sendAtPacificHour === undefined || Number(rule.sendAtPacificHour) === Number(businessHour);
}

function buildRuleExecutionPlan({ rule, businessDateKey, businessHour, force = false }) {
  const timedRuleDue = isTimedRuleDue({ rule, businessHour, force });
  return {
    ruleKey: rule.key,
    source: rule.source,
    timedRuleDue,
    expectedPacificHour: rule.sendAtPacificHour === undefined ? null : Number(rule.sendAtPacificHour),
    businessHour: Number(businessHour),
    weekendPolicy: rule.weekendPolicy,
    queryDateBeginDates:
      timedRuleDue && rule.source === "dateBegin" ? buildDateBeginQueryDates({ rule, businessDateKey }) : [],
    queryStatusChangeDates:
      timedRuleDue && rule.source === "statusChange"
        ? buildStatusChangeQueryDates({ businessDateKey })
        : [],
    skippedReason: timedRuleDue ? null : "outside-send-hour",
  };
}

function getPlacementCountryNormalized(placement) {
  const country = normalizeLower(getPlacementCountry(placement));
  if (country === "us" || country === "usa" || country === "united states of america") {
    return "united states";
  }
  return country;
}

function getPlacementEmploymentType(placement) {
  return normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
}

function getPrimaryOwner(placement) {
  return placement?.owner || placement?.candidate?.owner || placement?.jobOrder?.owner || {};
}

function getGreetingOwner(placement) {
  return placement?.candidate?.owner || placement?.owner || placement?.jobOrder?.owner || {};
}

function getMatchDetails(placement, rule, { change = null } = {}) {
  const country = getPlacementCountryNormalized(placement);
  const employmentType = getPlacementEmploymentType(placement);
  const status = normalizeLower(placement?.status);
  const newStatus = normalizeLower(change?.newValue || placement?.status);
  const oldStatus = normalizeLower(change?.oldValue);

  const checks = {
    countryMatches: !rule.country || country === rule.country,
    employmentTypeMatches: !rule.employmentType || employmentType === rule.employmentType,
    statusMatches: !rule.statusIn || rule.statusIn.has(status),
    newStatusMatches: !rule.newStatusIn || rule.newStatusIn.has(newStatus),
    oldStatusMatches: !rule.oldStatusIn || rule.oldStatusIn.has(oldStatus),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      country: getPlacementCountryNormalized(placement) || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      status: placement?.status || null,
      oldStatus: change?.oldValue ?? null,
      newStatus: change?.newValue ?? null,
    },
    expected: {
      country: rule.country,
      employmentType: rule.employmentType,
      statusIn: rule.statusIn ? Array.from(rule.statusIn) : null,
      oldStatusIn: rule.oldStatusIn ? Array.from(rule.oldStatusIn) : null,
      newStatusIn: rule.newStatusIn ? Array.from(rule.newStatusIn) : null,
    },
  };
}

function resolvePathValue(placement, selector) {
  const owner = getPrimaryOwner(placement);
  const values = {
    "owner.email": owner?.email,
    "owner.firstName": owner?.firstName,
  };
  return values[selector];
}

function resolveEmailValue(placement, value) {
  const normalized = normalizeString(value);
  if (normalized.includes("@")) {
    return normalizeLower(normalized);
  }
  return normalizeLower(resolvePathValue(placement, normalized));
}

function uniqueEmails(values, { exclude = [] } = {}) {
  const excludeSet = new Set(exclude.map((value) => normalizeLower(value)).filter(Boolean));
  const seen = new Set();
  const emails = [];
  for (const value of values) {
    const email = normalizeLower(value);
    if (!email || seen.has(email) || excludeSet.has(email)) {
      continue;
    }
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

function buildChecklistInlineImages(rule) {
  const images = [];
  for (const imagePath of rule.inlineImagePaths || []) {
    const resolvedPath = path.resolve(imagePath);
    const extension = path.extname(resolvedPath).toLowerCase();
    const type = extension === ".png" ? "image/png" : extension === ".jpeg" || extension === ".jpg" ? "image/jpeg" : "application/octet-stream";
    const cid = path.basename(resolvedPath).replace(/[^a-zA-Z0-9._-]/g, "-");
    const data = fs.readFileSync(resolvedPath).toString("base64");
    images.push({
      cid,
      name: cid,
      type,
      data,
      path: resolvedPath,
    });
  }
  return images;
}

function renderHtml({ placement, rule, inlineImages = [] }) {
  const candidate = placement?.candidate || {};
  const greetingOwner = getGreetingOwner(placement);
  const formattedDateBegin = formatDateBegin(placement?.dateBegin);
  const candidateName = buildFullName(candidate);
  const ownerGreeting = normalizeString(greetingOwner?.firstName) || "there";

  if (rule.templateVariant === "perm-checkin-missing") {
    return [
      "<!doctype html>",
      '<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6;">',
      "<p>Hello,</p>",
      "<p>Congratulations on your deal!</p>",
      `<p>We see that the candidate for placement ${normalizeString(placement?.id)} should have started on ${formattedDateBegin}. We have not been notified that a first day check-in has been added to the placement. We also have not received a response from the client or candidate via Sense, confirming the first day check-in. Please reach out to the client or candidate to get first day check-in confirmation.</p>`,
      "<p>Once you have confirmed the candidate has started, please upload the support to the placement and notify the CCS team via the onboarding inbox.</p>",
      "<p>Thank you,<br>Onboarding</p>",
      "</body></html>",
    ].join("");
  }

  if (rule.templateVariant === "deal-being-reviewed") {
    return [
      "<!doctype html>",
      '<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6;">',
      "<p>Hello,</p>",
      "<p>This is very exciting, your deal is currently in QC Review!</p>",
      `<p>Name: ${candidateName}<br>Candidate ID: ${normalizeString(candidate?.id)}<br>Placement ID: ${normalizeString(placement?.id)}</p>`,
      "<p>This process should only take a few minutes. Hopefully, you will soon receive that QCApproved email. If not, please keep an eye out for our request for information or placement corrections via IM, phone or email.</p>",
      "<p>Thank you,<br>C+CS Team</p>",
      "</body></html>",
    ].join("");
  }

  if (rule.templateVariant === "perm-confirm-scheduled-start") {
    return [
      "<!doctype html>",
      '<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6;">',
      `<p>Hello ${ownerGreeting}</p>`,
      "<p>Congrats on your deal! Our records show that you have a scheduled starter in 4 days. In preparation, please confirm that date with your candidate and prepare them to reply promptly to the sense perm check-in email.</p>",
      `<p>Name: ${candidateName}<br>Candidate ID: ${normalizeString(candidate?.id)}<br>Placement ID: ${normalizeString(placement?.id)}<br>Start Date: ${formattedDateBegin}</p>`,
      "<p>If you find that their start date has changed, please submit a change request and upload support of the new date as soon as possible.</p>",
      "<p>Thank you,<br>C+CS Team</p>",
      "</body></html>",
    ].join("");
  }

  if (rule.templateVariant === "placement-checklist-contract") {
    const [topImage, bottomImage] = inlineImages;
    return [
      "<!doctype html>",
      '<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6;">',
      `<p>Hello ${ownerGreeting}</p>`,
      "<p>Congrats on your deal!</p>",
      `<p>Name: ${candidateName}<br>Candidate ID: ${normalizeString(candidate?.id)}<br>Placement ID: ${normalizeString(placement?.id)}</p>`,
      "<p>We are excited about your deal and we know you are eager to see your deal get QC’d, for that reason we have created a checklist as a tool for you. Now that the placement is up we will issue your contract, provided that you have everything you need to release it. Double-check here:</p>",
      topImage ? `<p><img src="cid:${topImage.cid}" alt="Placement checklist summary" style="max-width:100%;height:auto;"></p>` : "",
      "<p>While we wait for the contract to go out and be signed. The checklist below contains tasks that you can complete to ensure your deal will be ready to be QC’d.</p>",
      bottomImage ? `<p><img src="cid:${bottomImage.cid}" alt="Placement checklist tasks" style="max-width:100%;height:auto;"></p>` : "",
      "<p>Thank you,<br>C+CS Team</p>",
      "</body></html>",
    ].join("");
  }

  const [permImage] = inlineImages;
  return [
    "<!doctype html>",
    '<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6;">',
    `<p>Hello ${ownerGreeting}</p>`,
    "<p>Congrats on your deal!</p>",
    `<p>Name: ${candidateName}<br>Candidate ID: ${normalizeString(candidate?.id)}<br>Placement ID: ${normalizeString(placement?.id)}</p>`,
    "<p>We are excited about your deal and we know you are eager to see your deal get QC’d, for that reason we have created a checklist as a tool for you. The checklist below contains tasks that need to be completed to ensure your deal will be ready to be QC’d.</p>",
    permImage ? `<p><img src="cid:${permImage.cid}" alt="Permanent placement checklist" style="max-width:100%;height:auto;"></p>` : "",
    "<p>Thank you,<br>C+CS Team</p>",
    "</body></html>",
  ].join("");
}

function renderText({ placement, rule }) {
  const candidate = placement?.candidate || {};
  const greetingOwner = getGreetingOwner(placement);
  const formattedDateBegin = formatDateBegin(placement?.dateBegin);
  const candidateName = buildFullName(candidate);
  const ownerGreeting = normalizeString(greetingOwner?.firstName) || "there";

  if (rule.templateVariant === "perm-checkin-missing") {
    return [
      "Hello,",
      "",
      "Congratulations on your deal!",
      "",
      `We see that the candidate for placement ${normalizeString(placement?.id)} should have started on ${formattedDateBegin}. We have not been notified that a first day check-in has been added to the placement. We also have not received a response from the client or candidate via Sense, confirming the first day check-in. Please reach out to the client or candidate to get first day check-in confirmation.`,
      "",
      "Once you have confirmed the candidate has started, please upload the support to the placement and notify the CCS team via the onboarding inbox.",
      "",
      "Thank you,",
      "Onboarding",
    ].join("\n");
  }

  if (rule.templateVariant === "deal-being-reviewed") {
    return [
      "Hello,",
      "",
      "This is very exciting, your deal is currently in QC Review!",
      "",
      `Name: ${candidateName}`,
      `Candidate ID: ${normalizeString(candidate?.id)}`,
      `Placement ID: ${normalizeString(placement?.id)}`,
      "",
      "This process should only take a few minutes. Hopefully, you will soon receive that QCApproved email. If not, please keep an eye out for our request for information or placement corrections via IM, phone or email.",
      "",
      "Thank you,",
      "C+CS Team",
    ].join("\n");
  }

  if (rule.templateVariant === "perm-confirm-scheduled-start") {
    return [
      `Hello ${ownerGreeting}`,
      "",
      "Congrats on your deal! Our records show that you have a scheduled starter in 4 days. In preparation, please confirm that date with your candidate and prepare them to reply promptly to the sense perm check-in email.",
      "",
      `Name: ${candidateName}`,
      `Candidate ID: ${normalizeString(candidate?.id)}`,
      `Placement ID: ${normalizeString(placement?.id)}`,
      `Start Date: ${formattedDateBegin}`,
      "",
      "If you find that their start date has changed, please submit a change request and upload support of the new date as soon as possible.",
      "",
      "Thank you,",
      "C+CS Team",
    ].join("\n");
  }

  if (rule.templateVariant === "placement-checklist-contract") {
    return [
      `Hello ${ownerGreeting}`,
      "",
      "Congrats on your deal!",
      "",
      `Name: ${candidateName}`,
      `Candidate ID: ${normalizeString(candidate?.id)}`,
      `Placement ID: ${normalizeString(placement?.id)}`,
      "",
      "We are excited about your deal and we know you are eager to see your deal get QC’d, for that reason we have created a checklist as a tool for you. Now that the placement is up we will issue your contract, provided that you have everything you need to release it.",
      "",
      "Please review the inline checklist images included in this email.",
      "",
      "Thank you,",
      "C+CS Team",
    ].join("\n");
  }

  return [
    `Hello ${ownerGreeting}`,
    "",
    "Congrats on your deal!",
    "",
    `Name: ${candidateName}`,
    `Candidate ID: ${normalizeString(candidate?.id)}`,
    `Placement ID: ${normalizeString(placement?.id)}`,
    "",
    "We are excited about your deal and we know you are eager to see your deal get QC’d, for that reason we have created a checklist as a tool for you. The checklist below contains tasks that need to be completed to ensure your deal will be ready to be QC’d.",
    "",
    "Please review the inline checklist image included in this email.",
    "",
    "Thank you,",
    "C+CS Team",
  ].join("\n");
}

function buildInlineTransmission({ placement, rule }) {
  const toEmail = resolveEmailValue(placement, rule.to);
  const ccEmails = uniqueEmails(rule.cc.map((value) => resolveEmailValue(placement, value)), {
    exclude: [toEmail],
  });
  const inlineImages = buildChecklistInlineImages(rule);
  const html = renderHtml({ placement, rule, inlineImages });
  const text = renderText({ placement, rule });

  const recipients = [
    {
      address: {
        email: toEmail,
      },
    },
    ...ccEmails.map((email) => ({
      address: {
        email,
        header_to: toEmail,
      },
    })),
  ].filter((recipient) => normalizeString(recipient?.address?.email));

  return {
    content: {
      from: rule.from,
      subject: rule.subject,
      text,
      html,
      ...(ccEmails.length > 0 ? { headers: { CC: ccEmails.join(", ") } } : {}),
      ...(inlineImages.length > 0
        ? {
            inline_images: inlineImages.map((image) => ({
              name: image.name,
              type: image.type,
              data: image.data,
            })),
          }
        : {}),
    },
    recipients,
    recipientEnvelope: {
      toEmail,
      ccEmails,
      missingToEmail: !toEmail,
    },
    inlineImagePaths: inlineImages.map((image) => image.path),
  };
}

function buildPlacementReportRecord({
  placement,
  rule,
  businessDateKey,
  queryDateBegin,
  change,
  transactionId,
  recipientEnvelope,
  sparkPostPayload,
  sendLock,
  inlineImagePaths = [],
}) {
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDateBegin: queryDateBegin || null,
    source: rule.source,
    ruleKey: rule.key,
    transactionId: transactionId || null,
    change: change
      ? {
          oldValue: change.oldValue ?? null,
          newValue: change.newValue ?? null,
        }
      : null,
    sendLock,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      dateBegin: placement?.dateBegin || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      country: getPlacementCountryNormalized(placement) || null,
      owner: placement?.owner || null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
    recipient: {
      toEmail: recipientEnvelope.toEmail || null,
      ccEmails: recipientEnvelope.ccEmails,
      missingToEmail: recipientEnvelope.missingToEmail,
    },
    inlineImagePaths,
    sparkPostPayload,
  };
}

function buildSkippedPlacementPreview({
  placement,
  rule,
  queryDateBegin,
  reason,
  matchDetails = null,
  change = null,
  transactionId = null,
}) {
  return {
    placementId: placement?.id ?? null,
    queryDateBegin: queryDateBegin || null,
    source: rule.source,
    ruleKey: rule.key,
    transactionId,
    reason,
    change: change
      ? {
          oldValue: change.oldValue ?? null,
          newValue: change.newValue ?? null,
        }
      : null,
    matchDetails,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      dateBegin: placement?.dateBegin ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      country: getPlacementCountryNormalized(placement) || null,
      owner: placement?.owner || null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
  };
}

module.exports = {
  QUERY_COUNT_DEFAULT,
  RULES,
  SKIPPED_PREVIEW_LIMIT,
  TEMPLATE_IMAGE_CIDS,
  TIME_ZONE,
  WORKFLOW_NAME,
  buildDateBeginQueryDates,
  buildInlineTransmission,
  buildPlacementReportRecord,
  buildRuleExecutionPlan,
  buildSkippedPlacementPreview,
  buildStatusChangeQueryDates,
  buildUtcDayWindowFromDateKey,
  getBusinessDateParts,
  getMatchDetails,
  getPrimaryOwner,
  isTimedRuleDue,
};
