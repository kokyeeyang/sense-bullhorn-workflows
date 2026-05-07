const crypto = require("node:crypto");

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function buildWorkflowSurveyToken({ payload, secret }) {
  if (!secret) {
    return "";
  }

  const payloadText = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payloadText).digest("base64url");
  return `${payloadText}.${signature}`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyWorkflowSurveyToken({ token, secret, expectedAnswer = null, expectedWorkflow = null }) {
  if (!secret) {
    throw new Error("Missing WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET");
  }

  const [payloadText, signature] = normalizeString(token).split(".");
  if (!payloadText || !signature) {
    throw new Error("Invalid survey token");
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(payloadText).digest("base64url");
  if (!safeEqual(signature, expectedSignature)) {
    throw new Error("Invalid survey token signature");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid survey token payload");
  }

  const answer = normalizeLower(payload?.answer);
  if (!["yes", "no"].includes(answer)) {
    throw new Error("Invalid survey answer");
  }

  if (expectedAnswer && answer !== normalizeLower(expectedAnswer)) {
    throw new Error("Survey answer does not match token");
  }

  const workflowName = normalizeString(payload?.workflowName);
  if (expectedWorkflow && workflowName !== expectedWorkflow) {
    throw new Error("Survey workflow does not match token");
  }

  return {
    workflowName,
    placementId: payload?.placementId ?? null,
    candidateId: payload?.candidateId ?? null,
    ownerId: payload?.ownerId ?? null,
    ownerEmail: normalizeLower(payload?.ownerEmail) || null,
    questionId: normalizeString(payload?.questionId) || null,
    questionText: normalizeString(payload?.questionText) || null,
    answer,
    issuedAt: normalizeString(payload?.issuedAt) || null,
    metadata: payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
  };
}

module.exports = {
  buildWorkflowSurveyToken,
  normalizeLower,
  normalizeString,
  verifyWorkflowSurveyToken,
};
