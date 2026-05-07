const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { saveWorkflowSurveyResponse } = require("../stores/workflowSurveyResponseStore");
const {
  START_DATE_APPROVAL_QUESTION_ID,
  START_DATE_APPROVAL_QUESTION_TEXT,
  WORKFLOW_NAME,
} = require("../utils/startDateApprovalReminderUtils");
const { verifyWorkflowSurveyToken } = require("../utils/workflowSurveyUtils");
const { serializeError } = require("../utils/workflowRuntime");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtmlPage({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; color: #202124; background: #f6f7f9; }
    main { max-width: 560px; margin: 8vh auto; background: #fff; padding: 32px; border: 1px solid #d8dde6; border-radius: 8px; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    p { line-height: 1.5; }
    button { background: #5630d3; border: 0; color: #fff; padding: 12px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

function htmlResponse({ status = 200, title, body }) {
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: buildHtmlPage({ title, body }),
  };
}

function getQueryValue(request, key) {
  return request.query.get(key) || "";
}

async function readForm(request) {
  const contentType = request.headers.get("content-type") || "";
  const text = await request.text();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }

  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function buildConfirmPage({ token, answer, payload }) {
  return htmlResponse({
    title: "Confirm response",
    body: `
      <h1>Confirm your response</h1>
      <p>Please confirm your answer for the placement start approval reminder survey.</p>
      <p><strong>Question:</strong> ${escapeHtml(payload.questionText || START_DATE_APPROVAL_QUESTION_TEXT)}</p>
      <p><strong>Your answer:</strong> ${escapeHtml(answer.toUpperCase())}</p>
      <form method="post">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <input type="hidden" name="answer" value="${escapeHtml(answer)}">
        <button type="submit">Confirm response</button>
      </form>
    `,
  });
}

function buildThanksPage({ payload }) {
  return htmlResponse({
    title: "Response recorded",
    body: `
      <h1>Thank you</h1>
      <p>Your response has been recorded.</p>
      <p><strong>Question:</strong> ${escapeHtml(payload.questionText || START_DATE_APPROVAL_QUESTION_TEXT)}</p>
      <p><strong>Answer:</strong> ${escapeHtml(payload.answer.toUpperCase())}</p>
    `,
  });
}

async function handleStartDateApprovalReminderResponse(request, context) {
  const config = loadConfig();

  try {
    const isPost = request.method.toUpperCase() === "POST";
    const form = isPost ? await readForm(request) : {};
    const token = isPost ? form.token : getQueryValue(request, "token");
    const answer = isPost ? form.answer : getQueryValue(request, "answer");
    const payload = verifyWorkflowSurveyToken({
      token,
      secret: config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET,
      expectedAnswer: answer,
      expectedWorkflow: WORKFLOW_NAME,
    });

    if (payload.questionId && payload.questionId !== START_DATE_APPROVAL_QUESTION_ID) {
      throw new Error("Survey question does not match token");
    }

    if (!isPost) {
      return buildConfirmPage({ token, answer: payload.answer, payload });
    }

    const userAgent = request.headers.get("user-agent") || "";
    const remoteAddress =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-client-ip") ||
      "";

    const writeResult = await saveWorkflowSurveyResponse({
      config,
      response: {
        ...payload,
        submittedAt: new Date().toISOString(),
        userAgent,
        remoteAddress,
      },
    });

    logger.info(
      {
        workflowName: WORKFLOW_NAME,
        placementId: payload.placementId,
        ownerId: payload.ownerId,
        answer: payload.answer,
        writeSkipped: writeResult.skipped,
      },
      "Start date approval reminder response captured",
    );

    return buildThanksPage({ payload });
  } catch (error) {
    context.error(serializeError(error), "Start date approval reminder response failed");
    return htmlResponse({
      status: 400,
      title: "Invalid response",
      body: `
        <h1>We could not record this response</h1>
        <p>The response link is invalid or incomplete. Please contact noreply@spencer-ogden.com.</p>
      `,
    });
  }
}

module.exports = {
  handleStartDateApprovalReminderResponse,
};
