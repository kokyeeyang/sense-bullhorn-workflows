require("dotenv").config();

const { DASHBOARD_EMAIL_WORKFLOWS } = require("../utils/dashboardWorkflows");
const { insertWorkflowEmailTransmissionPostgres } = require("../stores/postgresWorkflowEmailTransmissionStore");
const { saveWorkflowSurveyResponse } = require("../stores/workflowSurveyResponseStore");
const {
  buildTrackingPartitionKey,
  buildTrackingRowKey,
  upsertWorkflowSurveyTracking,
} = require("../stores/workflowSurveyTrackingStore");

const DEMO_DOMAIN = "demo.spencer-ogden.example";
const DEFAULT_EMAIL_ROWS_PER_WORKFLOW = 2;

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function getConfigFromEnv(env = process.env) {
  return {
    POSTGRES_CONNECTION_STRING: normalizeString(env.POSTGRES_CONNECTION_STRING),
    BULLHORN_ENV: normalizeString(env.BULLHORN_ENV) || "production",
    AZURE_TABLE_STORAGE_CONNECTION_STRING: normalizeString(env.AZURE_TABLE_STORAGE_CONNECTION_STRING),
    WORKFLOW_SURVEY_RESPONSE_TABLE_NAME: normalizeString(env.WORKFLOW_SURVEY_RESPONSE_TABLE_NAME) || "WorkflowSurveyResponses",
    WORKFLOW_SURVEY_TRACKING_TABLE_NAME: normalizeString(env.WORKFLOW_SURVEY_TRACKING_TABLE_NAME) || "WorkflowSurveyTracking",
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function workflowLabel(workflowName) {
  return workflowName
    .replace(/-sync$/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDummyTransmission({ workflowName, index, baseDate, environment }) {
  const sentAt = addDays(baseDate, -(index % 9));
  const runDate = dateKey(sentAt);
  const label = workflowLabel(workflowName);
  const candidateId = 900000 + index;
  const placementId = 800000 + index;
  const clientCorporationId = 700000 + index;
  const ownerId = 600000 + index;
  const recipientFirstName = index % 2 === 0 ? "Avery" : "Jordan";
  const recipientEmail = `${workflowName.replace(/[^a-z0-9]+/g, ".")}.${index}@${DEMO_DOMAIN}`;
  const fromEmail = index % 2 === 0 ? "onboarding@spencer-ogden.com" : "noreply@spencer-ogden.com";
  const subject = `[Dummy] ${label} email ${index + 1}`;
  const html = [
    "<!doctype html>",
    '<html lang="en"><body>',
    `<p>Hello ${recipientFirstName},</p>`,
    `<p>This is dummy dashboard showcase data for ${label}.</p>`,
    "<p>It is safe to filter out by send_type = dummy.</p>",
    "</body></html>",
  ].join("");

  return {
    environment,
    provider: "sparkpost",
    sendMethod: index % 2 === 0 ? "inline" : "template",
    sentAt: sentAt.toISOString(),
    payload: {
      content: {
        from: {
          name: index % 2 === 0 ? "Spencer Ogden Onboarding" : "Sales Operations Team",
          email: fromEmail,
        },
        subject,
        text: `Hello ${recipientFirstName}\nThis is dummy dashboard showcase data for ${label}.`,
        html,
        template_id: index % 2 === 0 ? "" : `dummy-${workflowName}`,
      },
      recipients: [
        {
          address: {
            email: recipientEmail,
          },
        },
      ],
    },
    providerResponse: {
      results: {
        id: `dummy-${workflowName}-${runDate}-${index + 1}`,
      },
    },
    audit: {
      workflowName,
      sendType: "dummy",
      ruleKey: index % 2 === 0 ? "dummy-initial" : "dummy-reminder",
      recipientType: workflowName.includes("placement-end-date") ? "jobOrderOwner" : "candidate",
      recipientEmail,
      recipientFirstName,
      placementId,
      candidateId,
      clientCorporationId,
      ownerId,
      ownerEmail: `owner.${index}@${DEMO_DOMAIN}`,
      businessDate: runDate,
      runDate,
      context: {
        source: "seed-dashboard-dummy-data",
        dummy: true,
      },
      metadata: {
        dummy: true,
        demoDataset: "dashboard-showcase",
        workflowLabel: label,
      },
    },
  };
}

function buildSurveyTrackingRows({ baseDate }) {
  const workflows = [
    "so-how-did-we-do-feedback-sync",
    "perm-checkin-sync",
    "us-contract-performance-checkin-sync",
    "start-date-approval-reminder-sync",
  ];
  const statuses = ["pending", "responded", "reminder-sent", "pending", "responded", "pending"];

  return statuses.map((status, index) => {
    const workflowName = workflows[index % workflows.length];
    const initialSentAt = addDays(baseDate, -index - 2);
    const reminderDueDate = dateKey(addDays(initialSentAt, 3));
    const surveyKey = `dummy-survey-${index + 1}`;
    return {
      partitionKey: buildTrackingPartitionKey({ workflowName, reminderDueDate }),
      rowKey: buildTrackingRowKey({ reminderDueDate, surveyKey }),
      workflowName,
      surveyKey,
      ruleKey: index % 2 === 0 ? "dummy-initial" : "dummy-follow-up",
      sendType: "dummy",
      recipientType: index % 2 === 0 ? "candidate" : "owner",
      recipientEmail: `survey.${index + 1}@${DEMO_DOMAIN}`,
      recipientFirstName: index % 2 === 0 ? "Taylor" : "Morgan",
      candidateId: 910000 + index,
      candidateName: index % 2 === 0 ? "Taylor Green" : "Morgan Lee",
      clientContactId: 920000 + index,
      clientContactName: "Demo Client Contact",
      placementId: 930000 + index,
      clientCorporationId: 940000 + index,
      clientCorporationName: "Demo Energy Ltd",
      employmentType: index % 2 === 0 ? "Contract" : "Perm",
      currentPlacementStatus: index % 3 === 0 ? "Approved" : "Active",
      businessDate: dateKey(initialSentAt),
      initialSentAt: initialSentAt.toISOString(),
      initialSentDate: dateKey(initialSentAt),
      reminderDueDate,
      reminderSentAt: status === "reminder-sent" ? addDays(initialSentAt, 3).toISOString() : "",
      respondedAt: status === "responded" ? addDays(initialSentAt, 1).toISOString() : "",
      responseAnswer: status === "responded" ? (index % 2 === 0 ? "yes" : "no") : "",
      trackingStatus: status,
      tokenIssuedAt: initialSentAt.toISOString(),
      context: {
        source: "seed-dashboard-dummy-data",
        dummy: true,
      },
      metadata: {
        dummy: true,
        demoDataset: "dashboard-showcase",
      },
      runDate: dateKey(initialSentAt),
    };
  });
}

function buildSurveyResponses({ baseDate }) {
  return [0, 1, 2, 3].map((index) => {
    const submittedAt = addDays(baseDate, -index - 1);
    const workflowName = index % 2 === 0
      ? "so-how-did-we-do-feedback-sync"
      : "perm-checkin-sync";
    return {
      workflowName,
      placementId: 930000 + index,
      candidateId: 910000 + index,
      ownerId: 600000 + index,
      ownerEmail: `owner.${index}@${DEMO_DOMAIN}`,
      recipientEmail: `survey.${index + 1}@${DEMO_DOMAIN}`,
      questionId: index % 2 === 0 ? "overall-experience" : "current-assignment-checkin",
      questionText: index % 2 === 0
        ? "How was your Spencer Ogden experience?"
        : "How is your current assignment going?",
      answer: index % 2 === 0 ? "positive" : "needs-follow-up",
      issuedAt: addDays(submittedAt, -2).toISOString(),
      submittedAt: submittedAt.toISOString(),
      surveyKey: `dummy-survey-${index + 1}`,
      metadata: {
        dummy: true,
        demoDataset: "dashboard-showcase",
        source: "seed-dashboard-dummy-data",
      },
      userAgent: "Dummy Dashboard Seeder",
      remoteAddress: "127.0.0.1",
    };
  });
}

async function run({
  emailRowsPerWorkflow = DEFAULT_EMAIL_ROWS_PER_WORKFLOW,
  baseDate = new Date(),
} = {}) {
  const config = getConfigFromEnv();
  if (!config.POSTGRES_CONNECTION_STRING) {
    throw new Error("POSTGRES_CONNECTION_STRING is required to seed dashboard dummy data");
  }

  const environment = normalizeString(config.BULLHORN_ENV).toLowerCase() || "production";
  const emailTransmissions = [];
  let emailRowsInserted = 0;

  for (const workflowName of DASHBOARD_EMAIL_WORKFLOWS) {
    for (let rowIndex = 0; rowIndex < emailRowsPerWorkflow; rowIndex += 1) {
      const globalIndex = emailTransmissions.length;
      const transmission = buildDummyTransmission({
        workflowName,
        index: globalIndex,
        baseDate,
        environment,
      });
      await insertWorkflowEmailTransmissionPostgres({ config, transmission });
      emailTransmissions.push(transmission);
      emailRowsInserted += 1;
    }
  }

  const surveyTrackingRows = buildSurveyTrackingRows({ baseDate });
  for (const tracking of surveyTrackingRows) {
    await upsertWorkflowSurveyTracking({ config, tracking });
  }

  const surveyResponses = buildSurveyResponses({ baseDate });
  for (const response of surveyResponses) {
    await saveWorkflowSurveyResponse({ config, response });
  }

  return {
    environment,
    emailWorkflowCount: DASHBOARD_EMAIL_WORKFLOWS.length,
    emailRowsPerWorkflow,
    emailRowsInserted,
    surveyTrackingRowsUpserted: surveyTrackingRows.length,
    surveyResponsesUpserted: surveyResponses.length,
  };
}

if (require.main === module) {
  run()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  buildDummyTransmission,
  buildSurveyResponses,
  buildSurveyTrackingRows,
  getConfigFromEnv,
  run,
};
