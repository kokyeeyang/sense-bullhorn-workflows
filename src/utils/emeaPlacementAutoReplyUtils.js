const { buildFullName, normalizeString } = require("./placementStartReminderUtils");
const { normalizeLower } = require("./workflowSurveyUtils");

const WORKFLOW_NAME = "emea-placement-auto-reply-sync";
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_COUNT_DEFAULT = 200;
const SKIPPED_PREVIEW_LIMIT = 50;

const FROM = {
  name: "EMEA CCS",
  email: "emea.ccs@spencer-ogden.com",
};

const EMEA_DEPARTMENTS = [
  "lon - aerospace",
  "lon - automotive",
  "lon - built environment",
  "lon - construction and property",
  "lon - contract automation",
  "lon - contract chemicals",
  "lon - contract et",
  "lon - contract o&g",
  "lon - contract o&g drilling",
  "lon - contract o&g engineering",
  "lon - contract o&g subsea",
  "lon - contract p&n",
  "lon - contract renewables",
  "lon - marine",
  "lon - perm engineering",
  "lon - perm et",
  "lon - perm finance",
  "lon - perm mining",
  "lon - perm o&g",
  "lon - perm p&n",
  "lon - perm renewables",
  "lon - rail",
  "london",
  "oil and gas london",
  "oil and gas perm - london",
  "manchester",
  "man - contract key accounts",
  "man - built environment",
  "man - utilities",
  "gla - contract o&g",
  "gla - contract renewables",
  "gla - marine",
  "gla - perm f&t",
  "gla - perm o&g",
  "gla - perm renewables",
];

const GERMANY_CONTRACT_DEPARTMENTS = [
  "ber - perm renewables",
  "berlin",
  "dus - contract built",
  "dusseldorf",
  "dus - contract power",
  "dus - contract renewables",
  "dus - perm renewables",
  "dus - perm built",
];

const GERMANY_PERM_DEPARTMENTS = [
  "ber - perm renewables",
  "berlin",
  "dus - contract built",
  "dusseldorf",
];

const CONTRACT_EMPLOYMENT_TYPES = new Set(["contract", "assignment", "margin only", "temporary"]);
const PERM_EMPLOYMENT_TYPES = new Set(["perm", "permanent"]);

const RULES = [
  {
    key: "germany-contract-placement-auto-reply",
    region: "Germany",
    employmentTypes: CONTRACT_EMPLOYMENT_TYPES,
    departments: GERMANY_CONTRACT_DEPARTMENTS,
    subject: "Herzlichen Glückwunsch!",
    templateVariant: "germany-contract",
  },
  {
    key: "germany-perm-placement-auto-reply",
    region: "Germany",
    employmentTypes: new Set(["perm"]),
    departments: GERMANY_PERM_DEPARTMENTS,
    subject: "Herzlichen Glückwunsch!",
    templateVariant: "germany-perm",
  },
  {
    key: "emea-contract-placement-auto-reply",
    region: "EMEA",
    employmentTypes: CONTRACT_EMPLOYMENT_TYPES,
    departments: EMEA_DEPARTMENTS,
    subject: "Congratulations",
    templateVariant: "emea-contract",
  },
  {
    key: "emea-perm-placement-auto-reply",
    region: "EMEA",
    employmentTypes: PERM_EMPLOYMENT_TYPES,
    departments: EMEA_DEPARTMENTS,
    subject: "Congratulations",
    templateVariant: "emea-perm",
  },
];

function dateKeyToUtcDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeString(dateKey))) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
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

function extractFieldChanges(fieldChanges) {
  if (Array.isArray(fieldChanges)) return fieldChanges;
  if (Array.isArray(fieldChanges?.data)) return fieldChanges.data;
  return [];
}

function findStatusChange(record) {
  return (
    extractFieldChanges(record?.fieldChanges).find(
      (change) => normalizeLower(change.columnName || change.fieldName) === "status",
    ) || null
  );
}

function getTransactionId(record) {
  return record?.transactionID || record?.transactionId || null;
}

function getOwner(placement) {
  return placement?.owner || placement?.jobOrder?.owner || placement?.candidate?.owner || {};
}

function getEmploymentType(placement) {
  return normalizeLower(placement?.employmentType || placement?.jobOrder?.employmentType);
}

function getOwnerDepartment(placement) {
  return normalizeLower(getOwner(placement)?.primaryDepartment?.name);
}

function statusIsPreHire(value) {
  return normalizeLower(value) === "pre-hire";
}

function departmentMatches(department, departments) {
  return departments.some((allowed) => department === normalizeLower(allowed));
}

function getRuleMatchDetails({ placement, rule, statusChange = null }) {
  const status = normalizeLower(placement?.status);
  const newStatus = normalizeLower(statusChange?.newValue || placement?.status);
  const oldStatus = normalizeLower(statusChange?.oldValue);
  const employmentType = getEmploymentType(placement);
  const ownerDepartment = getOwnerDepartment(placement);
  const checks = {
    statusChangeToPreHire: statusIsPreHire(newStatus),
    currentStatusPreHire: statusIsPreHire(status),
    employmentTypeMatches: rule.employmentTypes.has(employmentType),
    ownerDepartmentMatches: departmentMatches(ownerDepartment, rule.departments),
  };

  return {
    matched: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key),
    checks,
    actual: {
      status: placement?.status || null,
      oldStatus: statusChange?.oldValue ?? null,
      newStatus: statusChange?.newValue ?? null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      ownerDepartment: getOwner(placement)?.primaryDepartment?.name || null,
    },
    expected: {
      status: "pre-hire",
      employmentTypes: Array.from(rule.employmentTypes),
      ownerDepartments: rule.departments,
    },
  };
}

function findMatchingRule({ placement, statusChange = null }) {
  return RULES.find((rule) => getRuleMatchDetails({ placement, rule, statusChange }).matched) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderHtmlBody(rule) {
  if (rule.templateVariant === "emea-contract") {
    return [
      "<p>Congratulations on making your placement!</p>",
      "<p>The CCS team will begin to review your placement and assist in getting it on the dealboard!</p>",
      "<p>We can’t look to QC your placement until your contractor has returned their onboarding documents. You can check this is done via the ‘onboarding’ tab on the candidate record.</p>",
      "<p>In order to get your placement onto the dealboard as quickly as possible, please make sure you have done the below:</p>",
      "<p><strong>Documents to attach to Bullhorn</strong></p>",
      renderList([
        "Signed Client Contract",
        "Passport and copies of visas/work permits as applicable",
        "Client confirmation of the billing address & billing contact",
        "Purchase Order (if required and completed at time of placement)",
        "Client confirmation of start and end date",
        "Client confirmation of the charge rate",
        "Timesheets",
      ]),
      "<p>Please remember to set your contractor up for Online Timesheets (OLT). This can be done by adding the TS authoriser to the company page and then assigning the authoriser to your placement. You can do this whilst your placement is in 'pre-hire' or 'QC approved' status, but the contractor will only receive logins when the placement is 'approved'.</p>",
      "<p>If your deal falls outside of Spencer Ogden’s standard criteria, please make sure you have already obtained approvals for the following:</p>",
      renderList([
        "Candidate payment terms- Anything below 21 days Candidate payment terms requires Alan Stuart’s approval",
        "If the placement or billing country is down as ‘speak to legal’ then legal approval is required (if a high risk form is required, this needs attaching to Bullhorn)",
        "If your placement is offshore please remember to complete the information under the 'Offshore Placements' header of the placement record as well as attach your candidate's offshore safety certificates to the candidate record",
      ]),
      "<p>Please also make sure if your client is based within the EU the VAT number must be completed on the client record.</p>",
      "<p>The CCS team are available to assist if you have any further questions.</p>",
      "<p>Many thanks,</p>",
      "<p>EMEA Compliance and Contractor Services Team</p>",
    ].join("");
  }

  if (rule.templateVariant === "emea-perm") {
    return [
      "<p>Congratulations on making your placement!</p>",
      "<p>The CCS team will begin to review your placement and assist in getting it on the dealboard!</p>",
      "<p>In order to get your placement onto the dealboard as quickly as possible, please make sure you have done the below:</p>",
      "<p><strong>Documents to attach to Bullhorn</strong></p>",
      renderList([
        "Signed Client Contract",
        "Passport copy",
        "Client confirmation of the billing address & billing contact",
        "Purchase Order (if required and completed at time of placement)",
        "Client confirmation of start",
        "Client confirmation of placement fee or salary",
      ]),
      "<p>If your deal falls outside of Spencer Ogden’s standard criteria, please make sure you have already obtained approvals. This includes if the placement or billing country is down as ‘speak to legal’ as legal approval may be required.</p>",
      "<p>Please also make sure if your client is based within the EU the VAT number must be completed on the client record.</p>",
      "<p>The CCS team are available to assist if you have any further questions.</p>",
      "<p>Many thanks,</p>",
      "<p>EMEA Compliance and Contractor Services Team</p>",
    ].join("");
  }

  if (rule.templateVariant === "germany-contract") {
    return [
      "<p>Herzlichen Glückwunsch zu deinem Placement!</p>",
      "<p>Das CCS-Team wird umgehend damit beginnen, die vorliegenden Angaben und Unterlagen zu prüfen und dir dabei helfen, das Placement auf das Dealboard zu bekommen:</p>",
      "<p>Damit das so schnell wie möglich der Fall ist, vergewissere dich bitte, dass du folgende Schritte befolgt hast:</p>",
      "<p><strong>Diese Dokumente müssen dir vorliegen und in Bullhorn abgelegt werden:</strong></p>",
      renderList([
        "Unterzeichneter Kundenvertrag",
        "ID-Check (Bestätigung darüber Einsicht in den Ausweis/ Pass genommen bzw. ggf. Vorhandensein der Arbeitserlaubnis geprüft zu haben).",
        "Bestätigung der Rechnungsadresse des Kunden (per E-Mail) und der hierfür angegebenen Kontaktadresse",
        "Bestellung",
        "Bestätigung des Kunden über Start- und Enddatum",
        "Bestätigung des Kunden über den vereinbarten Stunden-/Tagessatz",
        "Ausgefülltes Welcome – Package des eingesetzten Mitarbeiters/Freiberuflers",
      ]),
      "<p>Sollte das Placement nicht die Spencer Ogden-Standardkriterien erfüllen, stelle bitte sicher, dass dir für die Ausnahmeregelungen die erforderlichen internen Freigaben vorliegen, dies gilt insbesondere für folgende Kriterien:</p>",
      renderList([
        "Zahlungsbedingungen für Kandidaten – Zahlungsziele unter 21 Tagen auf Seiten des Freiberuflers erfordern die Freigabe von Alan Stuart.",
        "Wenn der Kunde / Freiberufler mit dem du einen Geschäftsabschluss tätigst, seinen Sitz in einem Land hat, welches in unserer Sanction Policy als verboten erwähnt wird, ist eine Freigabe von Legal erforderlich.",
        "Sollte der Einsatz deines Placements im Ausland erfolgen, denke bitte daran die Informationen in Bullhorn unter dem Reiter „Offshore Placements“ vollständig auszufüllen. Ebenso sollten erforderliche Sicherheitszertifikate beim Kandidaten in Bullhorn hochgeladen werden.",
      ]),
      "<p>Bitte vergewissere dich auch, dass die Umsatzsteuer-Identifikationsnummer beim Kundendatensatz hinterlegt wird, wenn dieser seinen Sitz innerhalb der EU hat.</p>",
      "<p>Das CCS-Team steht dir für Fragen jederzeit zur Verfügung.</p>",
      "<p>Herzlichen Dank !</p>",
      "<p>Das EMEA Compliance and Contractor Services Team</p>",
    ].join("");
  }

  return [
    "<p>Herzlichen Glückwunsch zu deinem Placement!</p>",
    "<p>Das CCS-Team wird umgehend damit beginnen, die vorliegenden Angaben und Unterlagen zu prüfen und dir dabei helfen, das Placement auf das Dealboard zu bekommen:</p>",
    "<p>Damit das so schnell wie möglich der Fall ist, vergewissere dich bitte, dass du folgende Schritte befolgt hast:</p>",
    "<p><strong>Diese Dokumente müssen dir vorliegen und in Bullhorn abgelegt werden:</strong></p>",
    renderList([
      "Unterzeichneter Kundenvertrag",
      "ID-Check (Bestätigung darüber Einsicht in den Ausweis/ Pass genommen bzw. ggf. Vorhandensein der Arbeitserlaubnis geprüft zu haben).",
      "Bestätigung der Rechnungsadresse des Kunden (per E-Mail) und der hierfür angegebenen Kontaktadresse",
      "Ggf. eine Bestellung",
      "Kunden-Bestätigung , dass der Vertrag zwischen Kunden und Kandidaten unterzeichnet wurde oder entsprechender Nachweis darüber",
      "Bestätigung der vereinbarten Vermittlungsgebühr.",
    ]),
    "<p>Sollte das Placement nicht die Spencer Ogden-Standardkriterien erfüllen, stelle bitte sicher, dass dir für die Ausnahmeregelungen die erforderlichen internen Freigaben vorliegen, dies gilt insbesondere für folgende Kriterien:</p>",
    renderList([
      "Wenn der Kunde mit dem du einen Geschäftsabschluss tätigst, seinen Sitz in einem Land hat, welches in unserer Sanction Policy als verboten erwähnt wird, ist eine Freigabe von Legal erforderlich.",
    ]),
    "<p>Bitte vergewissere dich auch, dass die Umsatzsteuer-Identifikationsnummer beim Kundendatensatz hinterlegt wird, wenn dieser seinen Sitz innerhalb der EU hat.</p>",
    "<p>Sobald alle Verträge und oben genannte Information vorliegen bzw. Dateien dem Placement hinzugefügt werden, wird dein Placement umgehend von QC approved final genehmigt.</p>",
    "<p>Das CCS-Team steht dir für Fragen jederzeit zur Verfügung.</p>",
    "<p>Herzlichen Dank!</p>",
    "<p>Das EMEA Compliance and Contractor Services Team</p>",
  ].join("");
}

function htmlToText(html) {
  return normalizeString(html)
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
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

function buildInlineTransmission({ placement, rule }) {
  const owner = getOwner(placement);
  const toEmail = normalizeLower(owner?.email);
  const body = renderHtmlBody(rule);
  const html = [
    "<!doctype html>",
    '<html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#202124;line-height:1.6;">',
    body,
    "</body></html>",
  ].join("");

  return {
    content: {
      from: FROM,
      subject: rule.subject,
      text: htmlToText(body),
      html,
    },
    recipients: toEmail ? [{ address: { email: toEmail } }] : [],
    recipientEnvelope: {
      toEmail,
      missingToEmail: !toEmail,
    },
  };
}

function buildReportRecord({
  placement,
  rule,
  businessDateKey,
  queryDate,
  statusChange,
  transactionId,
  recipientEnvelope,
  sparkPostPayload,
  sendLock,
}) {
  const owner = getOwner(placement);
  return {
    placementId: placement?.id ?? null,
    businessDate: businessDateKey,
    queryDate,
    ruleKey: rule.key,
    region: rule.region,
    transactionId: transactionId || null,
    statusChange: statusChange
      ? {
          oldValue: statusChange.oldValue ?? null,
          newValue: statusChange.newValue ?? null,
        }
      : null,
    sendLock,
    placement: {
      id: placement?.id ?? null,
      status: placement?.status || null,
      employmentType: placement?.employmentType || placement?.jobOrder?.employmentType || null,
      owner: owner
        ? {
            id: owner.id ?? null,
            name: buildFullName(owner),
            email: owner.email || null,
            primaryDepartment: owner.primaryDepartment || null,
          }
        : null,
      candidate: placement?.candidate || null,
      clientCorporation: placement?.clientCorporation || null,
      jobOrder: placement?.jobOrder || null,
    },
    recipient: recipientEnvelope,
    sparkPostPayload,
  };
}

function buildSkippedItem({
  placement,
  rule = null,
  queryDate,
  reason,
  statusChange = null,
  transactionId = null,
  matchDetails = null,
}) {
  return {
    placementId: placement?.id ?? null,
    ruleKey: rule?.key || null,
    queryDate,
    transactionId,
    reason,
    statusChange: statusChange
      ? {
          oldValue: statusChange.oldValue ?? null,
          newValue: statusChange.newValue ?? null,
        }
      : null,
    matchDetails,
    placement: placement
      ? {
          id: placement.id ?? null,
          status: placement.status || null,
          employmentType: placement.employmentType || placement.jobOrder?.employmentType || null,
          ownerDepartment: getOwner(placement)?.primaryDepartment?.name || null,
          ownerEmail: getOwner(placement)?.email || null,
        }
      : null,
  };
}

module.exports = {
  QUERY_COUNT_DEFAULT,
  RULES,
  SKIPPED_PREVIEW_LIMIT,
  WORKFLOW_NAME,
  buildInlineTransmission,
  buildReportRecord,
  buildSkippedItem,
  buildUtcDayWindowFromDateKey,
  findMatchingRule,
  findStatusChange,
  getBusinessDateParts,
  getOwner,
  getRuleMatchDetails,
  getTransactionId,
};
