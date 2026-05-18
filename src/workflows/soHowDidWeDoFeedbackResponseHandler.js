const { loadConfig } = require("../helpers/config");
const { logger } = require("../helpers/logger");
const { BullhornClient } = require("../clients/bullhornClient");
const { saveWorkflowSurveyResponse } = require("../stores/workflowSurveyResponseStore");
const {
  getWorkflowSurveyTracking,
  upsertWorkflowSurveyTracking,
} = require("../stores/workflowSurveyTrackingStore");
const {
  SCORE_LEFT_LABEL,
  SCORE_OPTIONS,
  SCORE_RIGHT_LABEL,
  SURVEY_QUESTION_ID,
  SURVEY_QUESTION_TEXT,
  WORKFLOW_NAME,
} = require("../utils/soHowDidWeDoFeedbackUtils");
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
    main { max-width: 640px; margin: 8vh auto; background: #fff; padding: 32px; border: 1px solid #d8dde6; border-radius: 8px; }
    h1 { font-size: 22px; margin: 0 0 16px; }
    p { line-height: 1.5; }
    button { background: #5630d3; border: 0; color: #fff; padding: 12px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; }
    .scale { display:grid; grid-template-columns:repeat(10, minmax(0, 1fr)); gap:8px; margin:16px 0 10px; }
    .scale div { border:1px solid #d0d5dd; border-radius:6px; padding:10px 0; text-align:center; font-weight:700; background:#f8fafc; }
    .scale-option input { position:absolute; opacity:0; pointer-events:none; }
    .scale-option label { display:block; border:1px solid #d0d5dd; border-radius:6px; padding:10px 0; text-align:center; font-weight:700; background:#f8fafc; cursor:pointer; }
    .scale-option input:checked + label { background:#5630d3; color:#fff; border-color:#5630d3; }
    .labels { display:flex; justify-content:space-between; font-size:12px; color:#667085; }
    .helper { font-size: 14px; color:#667085; }
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

function buildScalePreview(answer) {
  return `
    <div class="scale">${SCORE_OPTIONS.map((value) => `<div${value === answer ? ' style="background:#5630d3;color:#fff;border-color:#5630d3;"' : ""}>${value}</div>`).join("")}</div>
    <div class="labels"><span>${escapeHtml(SCORE_LEFT_LABEL)}</span><span>${escapeHtml(SCORE_RIGHT_LABEL)}</span></div>
  `;
}

function buildScalePicker(selectedAnswer = "") {
  return `
    <div class="scale">
      ${SCORE_OPTIONS.map(
        (value) => `
          <div class="scale-option">
            <input type="radio" id="score-${value}" name="answer" value="${value}"${value === selectedAnswer ? " checked" : ""}>
            <label for="score-${value}">${value}</label>
          </div>
        `,
      ).join("")}
    </div>
    <div class="labels"><span>${escapeHtml(SCORE_LEFT_LABEL)}</span><span>${escapeHtml(SCORE_RIGHT_LABEL)}</span></div>
  `;
}

function isValidScoreAnswer(answer) {
  return SCORE_OPTIONS.includes(String(answer || ""));
}

function parseNpsScore(answer) {
  const score = Number(String(answer ?? "").trim());
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    return null;
  }

  return score;
}

function buildCandidateCurrentNpsPatch(answer) {
  const score = parseNpsScore(answer);
  if (score === null) {
    return null;
  }

  return { customFloat1: score };
}

function buildCandidateNpsNoteComments(answer) {
  const score = parseNpsScore(answer);
  if (score === null) {
    return "";
  }

  return `NPS Feedback : ${score}`;
}

function didPersistToPostgres(result) {
  return Array.isArray(result?.results) &&
    result.results.some((item) => item.target === "postgres" && !item.skipped);
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildRespondedTrackingRecord({ entity = null, payload, answer, respondedAt }) {
  const metadata = entity ? parseJsonObject(entity.metadataJson) : parseJsonObject(payload.metadata);
  const context = entity ? parseJsonObject(entity.contextJson) : {};
  const reminderDueDate =
    entity?.reminderDueDate ||
    String(payload.trackingRowKey || "").split("|")[0] ||
    "";
  const issuedDate = String(payload.issuedAt || respondedAt || "").slice(0, 10);

  return {
    partitionKey: entity?.partitionKey || payload.trackingPartitionKey,
    rowKey: entity?.rowKey || payload.trackingRowKey,
    workflowName: WORKFLOW_NAME,
    surveyKey: entity?.surveyKey || payload.surveyKey || "",
    ruleKey: entity?.ruleKey || metadata.ruleKey || "",
    recipientType: entity?.recipientType || metadata.recipientType || "",
    recipientEmail: entity?.recipientEmail || payload.recipientEmail || "",
    recipientFirstName: entity?.recipientFirstName || "",
    candidateId: entity?.candidateId ?? payload.candidateId ?? null,
    candidateName: entity?.candidateName || "",
    clientContactId: entity?.clientContactId ?? null,
    clientContactName: entity?.clientContactName || "",
    placementId: entity?.placementId ?? payload.placementId ?? null,
    clientCorporationId: entity?.clientCorporationId ?? null,
    clientCorporationName: entity?.clientCorporationName || "",
    employmentType: entity?.employmentType || "",
    currentPlacementStatus: entity?.currentPlacementStatus || "",
    businessDate: entity?.businessDate || entity?.initialSentDate || issuedDate,
    initialSentAt: entity?.initialSentAt || payload.issuedAt || "",
    initialSentDate: entity?.initialSentDate || issuedDate,
    reminderDueDate,
    reminderSentAt: entity?.reminderSentAt || "",
    respondedAt,
    responseAnswer: answer,
    trackingStatus: "responded",
    tokenIssuedAt: entity?.tokenIssuedAt || payload.issuedAt || "",
    context,
    metadata,
    runDate: entity?.initialSentDate || entity?.businessDate || issuedDate,
  };
}

async function updateCandidateCurrentNps({ config, candidateId, answer, log = logger }) {
  const patch = buildCandidateCurrentNpsPatch(answer);
  const score = patch?.customFloat1 ?? null;

  if (!patch) {
    return { updated: false, reason: "invalid-score", candidateId: candidateId ?? null, score };
  }

  if (!candidateId) {
    return { updated: false, reason: "missing-candidate-id", candidateId: null, score };
  }

  try {
    const bullhorn = new BullhornClient({ config, logger: log });
    const code = await bullhorn.getAuthorizationCode();
    const accessToken = await bullhorn.getAccessToken(code);
    const session = await bullhorn.login(accessToken);

    await bullhorn.updateCandidate({
      ...session,
      candidateId,
      patch,
    });

    const noteComments = buildCandidateNpsNoteComments(answer);
    let noteResult = { created: false, reason: "missing-note-comments" };
    if (noteComments) {
      try {
        const createdNote = await bullhorn.createCandidateNote({
          ...session,
          candidateId,
          comments: noteComments,
        });
        noteResult = {
          created: true,
          noteId: createdNote.noteId || null,
          comments: noteComments,
        };
      } catch (error) {
        log.warn(
          {
            candidateId,
            score,
            comments: noteComments,
            error: serializeError(error),
          },
          "Failed to create Bullhorn candidate NPS note",
        );
        noteResult = {
          created: false,
          reason: "bullhorn-note-create-failed",
          comments: noteComments,
        };
      }
    }

    return { updated: true, candidateId, score, noteResult };
  } catch (error) {
    log.warn(
      {
        candidateId,
        score,
        error: serializeError(error),
      },
      "Failed to update Bullhorn candidate Current NPS",
    );

    return { updated: false, reason: "bullhorn-update-failed", candidateId, score };
  }
}

async function handleSoHowDidWeDoFeedbackResponse(request, context) {
  const config = loadConfig();

  try {
    const isPost = request.method.toUpperCase() === "POST";
    const form = isPost ? await readForm(request) : {};
    const token = isPost ? form.token : getQueryValue(request, "token");
    const answer = isPost ? String(form.answer || "") : "";
    const payload = verifyWorkflowSurveyToken({
      token,
      secret: config.WORKFLOW_SURVEY_RESPONSE_SIGNING_SECRET,
      expectedWorkflow: WORKFLOW_NAME,
      allowMissingAnswer: true,
    });

    if (payload.questionId && payload.questionId !== SURVEY_QUESTION_ID) {
      throw new Error("Survey question does not match token");
    }

    if (!isPost) {
      return htmlResponse({
        title: "Share feedback",
        body: `
          <h1>Share your feedback</h1>
          <p>Please choose a score below and submit your response.</p>
          <p><strong>Question:</strong> ${escapeHtml(payload.questionText || SURVEY_QUESTION_TEXT)}</p>
          <p class="helper">1 means ${escapeHtml(SCORE_LEFT_LABEL.toLowerCase())}. 10 means ${escapeHtml(SCORE_RIGHT_LABEL.toLowerCase())}.</p>
          <form method="post">
            <input type="hidden" name="token" value="${escapeHtml(token)}">
            ${buildScalePicker()}
            <button type="submit">Submit response</button>
          </form>
        `,
      });
    }

    if (!isValidScoreAnswer(answer)) {
      return htmlResponse({
        status: 400,
        title: "Choose a score",
        body: `
          <h1>Please choose a score</h1>
          <p>Select a score from 1 to 10 before submitting your response.</p>
          <p><strong>Question:</strong> ${escapeHtml(payload.questionText || SURVEY_QUESTION_TEXT)}</p>
          <form method="post">
            <input type="hidden" name="token" value="${escapeHtml(token)}">
            ${buildScalePicker(answer)}
            <button type="submit">Submit response</button>
          </form>
        `,
      });
    }

    const userAgent = request.headers.get("user-agent") || "";
    const remoteAddress =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-client-ip") ||
      "";

    const responseSaveResult = await saveWorkflowSurveyResponse({
      config,
      response: {
        ...payload,
        answer,
        submittedAt: new Date().toISOString(),
        userAgent,
        remoteAddress,
      },
    });
    if (responseSaveResult.skipped) {
      logger.warn(
        {
          workflowName: WORKFLOW_NAME,
          candidateId: payload.candidateId,
          surveyKey: payload.surveyKey || null,
          responseSaveResult,
        },
        "SO How Did We Do feedback response was not persisted to any response store",
      );
    }
    if (!didPersistToPostgres(responseSaveResult)) {
      logger.warn(
        {
          workflowName: WORKFLOW_NAME,
          candidateId: payload.candidateId,
          surveyKey: payload.surveyKey || null,
          responseSaveResult,
        },
        "SO How Did We Do feedback response was not persisted to Postgres workflow_survey_responses",
      );
    }

    const currentNpsUpdate = await updateCandidateCurrentNps({
      config,
      candidateId: payload.candidateId,
      answer,
    });

    let trackingUpdateResult = { skipped: true, reason: "missing-tracking-key" };
    if (payload.trackingPartitionKey && payload.trackingRowKey) {
      let entity = null;
      try {
        entity = await getWorkflowSurveyTracking({
          config,
          partitionKey: payload.trackingPartitionKey,
          rowKey: payload.trackingRowKey,
        });
      } catch (error) {
        logger.warn(
          {
            workflowName: WORKFLOW_NAME,
            candidateId: payload.candidateId,
            surveyKey: payload.surveyKey || null,
            error: serializeError(error),
          },
          "Could not read existing SO How Did We Do survey tracking row; using token fallback",
        );
      }

      const respondedAt = new Date().toISOString();
      trackingUpdateResult = await upsertWorkflowSurveyTracking({
        config,
        tracking: buildRespondedTrackingRecord({
          entity,
          payload,
          answer,
          respondedAt,
        }),
      });
    }

    logger.info(
      {
        workflowName: WORKFLOW_NAME,
        placementId: payload.placementId,
        answer,
        surveyKey: payload.surveyKey || null,
        responseSaveResult,
        trackingUpdateResult,
        currentNpsUpdate,
      },
      "SO How Did We Do feedback response captured",
    );

    return htmlResponse({
      title: "Response recorded",
      body: `
        <h1>Thank you</h1>
        <p>Your response has been recorded.</p>
        <p><strong>Question:</strong> ${escapeHtml(payload.questionText || SURVEY_QUESTION_TEXT)}</p>
        ${buildScalePreview(answer)}
      `,
    });
  } catch (error) {
    context.error(serializeError(error), "SO How Did We Do feedback response failed");
    return htmlResponse({
      status: 400,
      title: "Invalid response",
      body: `
        <h1>We could not record this response</h1>
        <p>The response link is invalid or incomplete. Please contact sohowdidwedo@spencer-ogden.com.</p>
      `,
    });
  }
}

module.exports = {
  buildCandidateNpsNoteComments,
  buildCandidateCurrentNpsPatch,
  buildRespondedTrackingRecord,
  didPersistToPostgres,
  handleSoHowDidWeDoFeedbackResponse,
  parseNpsScore,
  updateCandidateCurrentNps,
};
