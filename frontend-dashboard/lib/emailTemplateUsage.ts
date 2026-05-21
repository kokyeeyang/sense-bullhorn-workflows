export type EmailTemplateUsage = {
  fileName: string;
  workflowName: string;
  workflowLabel: string;
  role: string;
  sendMethod: "inline-html" | "sparkpost-template";
  configKey?: string | null;
  ruleKey?: string | null;
};

function usage(
  fileName: string,
  workflowName: string,
  workflowLabel: string,
  role: string,
  sendMethod: EmailTemplateUsage["sendMethod"] = "inline-html",
  extra: Pick<EmailTemplateUsage, "configKey" | "ruleKey"> = {},
): EmailTemplateUsage {
  return {
    fileName,
    workflowName,
    workflowLabel,
    role,
    sendMethod,
    configKey: extra.configKey || null,
    ruleKey: extra.ruleKey || null,
  };
}

export const EMAIL_TEMPLATE_USAGE: EmailTemplateUsage[] = [
  usage("approved-placement-apac.html", "approved-placement-apac-sync", "Approved Placement APAC", "Approved placement notification"),
  usage("awr-client-request.html", "awr-client-request-sync", "AWR Client Request", "AWR client request"),
  usage(
    "contractor-not-contacted-reminder.html",
    "contractor-not-contacted-reminder-sync",
    "Contractor Not Contacted Reminder",
    "Contractor contact reminder",
  ),
  usage(
    "job-application-notification.html",
    "job-application-notification-sync",
    "Job Application Notification",
    "Job application notification",
  ),
  usage("payroll-new-hire-greeting.html", "payroll-new-hire-greeting-sync", "Payroll New Hire Greeting", "New hire greeting"),
  usage("placement-end-date-reminder.html", "placement-end-date-reminder-sync", "Placement End Date Reminder", "End date reminder"),
  usage("so-how-did-we-do-feedback.html", "so-how-did-we-do-feedback-sync", "SO How Did We Do Feedback", "Initial feedback request"),
  usage("so-how-did-we-do-reminder.html", "so-how-did-we-do-feedback-sync", "SO How Did We Do Feedback", "Feedback reminder"),
  usage("start-date-approval-reminder.html", "start-date-approval-reminder-sync", "Start Date Approval Reminder", "Approval reminder"),
  usage(
    "us-contract-performance-checkin.html",
    "us-contract-performance-checkin-sync",
    "US Contract Performance Check-in",
    "Performance check-in survey",
  ),
  usage("ais-survivex-certification-renewal.html", "ais-survivex-certification-sync", "AIS Survivex Certification", "Renewal reminder"),
  usage("americas-welcome-contract-email.html", "americas-welcome-contract-email-sync", "Americas Welcome Contract Email", "Welcome contract email"),
  usage("fair-collection-notice.html", "fair-collection-notice-sync", "Fair Collection Notice", "Fair collection notice"),
  usage("vestas-po.html", "vestas-po-sync", "Vestas PO", "PO turnaround survey"),

  usage(
    "americas-paid-leave-onboarding.html",
    "americas-onboarding-notices-sync",
    "Americas Onboarding Notices",
    "Paid leave onboarding notice",
    "inline-html",
    { ruleKey: "paid-leave" },
  ),
  usage(
    "americas-oregon-workplace-fairness.html",
    "americas-onboarding-notices-sync",
    "Americas Onboarding Notices",
    "Oregon workplace fairness notice",
    "inline-html",
    { ruleKey: "oregon-workplace-fairness" },
  ),
  usage(
    "americas-new-york-city-hero-act.html",
    "americas-onboarding-notices-sync",
    "Americas Onboarding Notices",
    "NYC HERO Act notice",
    "inline-html",
    { ruleKey: "new-york-city-hero-act" },
  ),
  usage(
    "americas-new-york-city-commuter.html",
    "americas-onboarding-notices-sync",
    "Americas Onboarding Notices",
    "NYC commuter benefits notice",
    "inline-html",
    { ruleKey: "new-york-city-commuter" },
  ),

  usage(
    "termination-alabama-notice.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "Alabama termination notice",
    "inline-html",
    { ruleKey: "alabama-termination-notice" },
  ),
  usage(
    "termination-colorado.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "Colorado termination notice",
    "inline-html",
    { ruleKey: "colorado-termination" },
  ),
  usage(
    "termination-georgia.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "Georgia termination notice",
    "inline-html",
    { ruleKey: "georgia-termination" },
  ),
  usage(
    "termination-generic-unemployment-notice.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "Generic unemployment termination notice",
    "inline-html",
    { ruleKey: "multiple-state-termination-notices" },
  ),
  usage(
    "termination-maryland.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "Maryland termination notice",
    "inline-html",
    { ruleKey: "maryland-termination" },
  ),
  usage(
    "termination-california-change-in-relationship.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "California change in relationship",
    "inline-html",
    { ruleKey: "california-change-in-relationship" },
  ),
  usage(
    "termination-new-jersey-unemployment-benefits.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "New Jersey unemployment benefits",
    "inline-html",
    { ruleKey: "new-jersey-unemployment-benefits" },
  ),
  usage(
    "termination-apac-perm-invoicing.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "APAC perm termination invoicing",
    "inline-html",
    { ruleKey: "apac-perm-termination-invoicing" },
  ),
  usage(
    "termination-end-of-month-contract-reminder.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "End-of-month contract reminder",
    "inline-html",
    { ruleKey: "end-of-month-contract-reminder" },
  ),
  usage(
    "termination-us-perm-invoice.html",
    "placement-termination-workflows-sync",
    "Placement Termination Workflows",
    "US perm termination invoice",
    "inline-html",
    { ruleKey: "us-perm-termination-invoice" },
  ),

  usage(
    "harassment-training-onboarding-confirmation.html",
    "harassment-training-sync",
    "Harassment Training",
    "Illinois and Maine onboarding confirmation",
    "sparkpost-template",
    { configKey: "HARASSMENT_TRAINING_ONBOARDING_SPARKPOST_TEMPLATE_ID" },
  ),
  usage(
    "harassment-training-state-notice.html",
    "harassment-training-sync",
    "Harassment Training",
    "Connecticut and New York state notice",
    "sparkpost-template",
    { configKey: "HARASSMENT_TRAINING_STATE_NOTICE_SPARKPOST_TEMPLATE_ID" },
  ),
  usage(
    "harassment-training-california-notice.html",
    "harassment-training-sync",
    "Harassment Training",
    "California training notice",
    "sparkpost-template",
    { configKey: "HARASSMENT_TRAINING_CALIFORNIA_SPARKPOST_TEMPLATE_ID" },
  ),
];

export function getEmailTemplateUsageByFileName() {
  return EMAIL_TEMPLATE_USAGE.reduce<Record<string, EmailTemplateUsage[]>>((usageByFileName, item) => {
    usageByFileName[item.fileName] = [...(usageByFileName[item.fileName] || []), item];
    return usageByFileName;
  }, {});
}
