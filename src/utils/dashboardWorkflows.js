const DASHBOARD_WORKFLOWS = [
  "candidate-state-sync",
  "placement-database-enrichment-sync",
  "placement-status-sync",
  "placement-termination-email-sync",
  "placement-termination-workflows-sync",
  "interview-illinois-email-sync",
  "new-job-illinois-email-sync",
  "placement-start-reminder-sync",
  "placement-benefits-reminder-sync",
  "us-contract-performance-checkin-sync",
  "harassment-training-sync",
  "placement-yearly-fee-increase-sync",
  "client-contact-dnc-sync",
  "client-corporation-360-sync",
  "client-corporation-key-account-sync",
];

const DASHBOARD_EMAIL_WORKFLOWS = [
  "placement-termination-email-sync",
  "placement-termination-workflows-sync",
  "interview-illinois-email-sync",
  "new-job-illinois-email-sync",
  "placement-start-reminder-sync",
  "placement-yearly-fee-increase-sync",
  "placement-benefits-reminder-sync",
  "us-contract-performance-checkin-sync",
  "harassment-training-sync",
];

module.exports = {
  DASHBOARD_EMAIL_WORKFLOWS,
  DASHBOARD_WORKFLOWS,
};
