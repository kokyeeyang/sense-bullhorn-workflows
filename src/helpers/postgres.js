const { Pool } = require("pg");

let cachedPool = null;
let cachedConnectionString = null;
let ensureSchemaPromise = null;

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function isPostgresEnabled(config) {
  return Boolean(normalizeString(config.POSTGRES_CONNECTION_STRING));
}

function getPool({ config }) {
  const connectionString = normalizeString(config.POSTGRES_CONNECTION_STRING);
  if (!connectionString) {
    return null;
  }

  if (cachedPool && cachedConnectionString === connectionString) {
    return cachedPool;
  }

  cachedPool = new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });
  cachedConnectionString = connectionString;
  ensureSchemaPromise = null;

  return cachedPool;
}

async function ensureSchema({ config }) {
  const pool = getPool({ config });
  if (!pool) {
    return false;
  }

  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_run_logs (
          id BIGSERIAL PRIMARY KEY,
          environment TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          run_date DATE NOT NULL,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ,
          started_at_display TEXT NOT NULL DEFAULT '',
          finished_at_display TEXT NOT NULL DEFAULT '',
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          summary TEXT NOT NULL DEFAULT '',
          details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          artifact_path TEXT NOT NULL DEFAULT '',
          emailed_in_daily_summary BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_run_logs_lookup
        ON workflow_run_logs (environment, workflow_name, run_date, finished_at);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_dashboard_metrics_daily (
          environment TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          run_date DATE NOT NULL,
          month_key TEXT NOT NULL,
          total_runs INTEGER NOT NULL DEFAULT 0,
          successful_runs INTEGER NOT NULL DEFAULT 0,
          failed_runs INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          comparison_record_count INTEGER NOT NULL DEFAULT 0,
          updated_count INTEGER NOT NULL DEFAULT 0,
          would_update_count INTEGER NOT NULL DEFAULT 0,
          sent_email_count INTEGER NOT NULL DEFAULT 0,
          would_send_email_count INTEGER NOT NULL DEFAULT 0,
          total_email_count INTEGER NOT NULL DEFAULT 0,
          skipped_action_count INTEGER NOT NULL DEFAULT 0,
          field_change_count INTEGER NOT NULL DEFAULT 0,
          action_decision_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          record_type_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          entity_type_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          field_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          stage_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          skip_reason_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          first_run_at TIMESTAMPTZ,
          last_run_at TIMESTAMPTZ,
          last_run_at_display TEXT NOT NULL DEFAULT '',
          last_run_status TEXT NOT NULL DEFAULT '',
          last_summary TEXT NOT NULL DEFAULT '',
          artifact_path TEXT NOT NULL DEFAULT '',
          last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (environment, run_date, workflow_name)
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_dashboard_metrics_by_workflow (
          environment TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          run_date DATE NOT NULL,
          month_key TEXT NOT NULL,
          total_runs INTEGER NOT NULL DEFAULT 0,
          successful_runs INTEGER NOT NULL DEFAULT 0,
          failed_runs INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          comparison_record_count INTEGER NOT NULL DEFAULT 0,
          updated_count INTEGER NOT NULL DEFAULT 0,
          would_update_count INTEGER NOT NULL DEFAULT 0,
          sent_email_count INTEGER NOT NULL DEFAULT 0,
          would_send_email_count INTEGER NOT NULL DEFAULT 0,
          total_email_count INTEGER NOT NULL DEFAULT 0,
          skipped_action_count INTEGER NOT NULL DEFAULT 0,
          field_change_count INTEGER NOT NULL DEFAULT 0,
          action_decision_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          record_type_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          entity_type_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          field_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          stage_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          skip_reason_counts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          first_run_at TIMESTAMPTZ,
          last_run_at TIMESTAMPTZ,
          last_run_at_display TEXT NOT NULL DEFAULT '',
          last_run_status TEXT NOT NULL DEFAULT '',
          last_summary TEXT NOT NULL DEFAULT '',
          artifact_path TEXT NOT NULL DEFAULT '',
          last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (environment, workflow_name, run_date)
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_comparison_records (
          id BIGSERIAL PRIMARY KEY,
          environment TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          run_date DATE NOT NULL,
          generated_at TIMESTAMPTZ,
          source_system TEXT NOT NULL DEFAULT 'azure-functions',
          record_type TEXT NOT NULL DEFAULT '',
          action_decision TEXT NOT NULL DEFAULT '',
          entity_type TEXT NOT NULL DEFAULT '',
          entity_id BIGINT,
          transaction_id TEXT NOT NULL DEFAULT '',
          candidate_id BIGINT,
          related_id BIGINT,
          details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_comparison_records_lookup
        ON workflow_comparison_records (environment, workflow_name, run_date);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_survey_tracking (
          partition_key TEXT NOT NULL,
          row_key TEXT NOT NULL,
          environment TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          survey_key TEXT NOT NULL,
          rule_key TEXT NOT NULL DEFAULT '',
          send_type TEXT NOT NULL DEFAULT 'initial',
          recipient_type TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL DEFAULT '',
          recipient_first_name TEXT NOT NULL DEFAULT '',
          candidate_id BIGINT,
          candidate_name TEXT NOT NULL DEFAULT '',
          client_contact_id BIGINT,
          client_contact_name TEXT NOT NULL DEFAULT '',
          placement_id BIGINT,
          client_corporation_id BIGINT,
          client_corporation_name TEXT NOT NULL DEFAULT '',
          employment_type TEXT NOT NULL DEFAULT '',
          current_placement_status TEXT NOT NULL DEFAULT '',
          business_date TEXT NOT NULL DEFAULT '',
          initial_sent_at TIMESTAMPTZ,
          initial_sent_date TEXT NOT NULL DEFAULT '',
          reminder_due_date TEXT NOT NULL DEFAULT '',
          reminder_sent_at TIMESTAMPTZ,
          responded_at TIMESTAMPTZ,
          response_answer TEXT NOT NULL DEFAULT '',
          tracking_status TEXT NOT NULL DEFAULT 'pending',
          token_issued_at TIMESTAMPTZ,
          context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          run_date TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (partition_key, row_key)
        );
      `);

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_survey_tracking_survey_key
        ON workflow_survey_tracking (survey_key);
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_survey_tracking_due
        ON workflow_survey_tracking (workflow_name, reminder_due_date, responded_at, reminder_sent_at);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_survey_responses (
          partition_key TEXT NOT NULL,
          row_key TEXT NOT NULL,
          submitted_at TIMESTAMPTZ,
          workflow_name TEXT NOT NULL,
          placement_id BIGINT,
          candidate_id BIGINT,
          owner_id BIGINT,
          owner_email TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL DEFAULT '',
          question_id TEXT NOT NULL DEFAULT '',
          question_text TEXT NOT NULL DEFAULT '',
          answer TEXT NOT NULL DEFAULT '',
          issued_at TIMESTAMPTZ,
          survey_key TEXT NOT NULL DEFAULT '',
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          user_agent TEXT NOT NULL DEFAULT '',
          remote_address TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (partition_key, row_key)
        );
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_survey_responses_lookup
        ON workflow_survey_responses (workflow_name, survey_key, submitted_at);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS workflow_email_transmissions (
          id BIGSERIAL PRIMARY KEY,
          environment TEXT NOT NULL,
          workflow_name TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT '',
          send_method TEXT NOT NULL DEFAULT '',
          send_type TEXT NOT NULL DEFAULT '',
          rule_key TEXT NOT NULL DEFAULT '',
          recipient_type TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL DEFAULT '',
          recipient_first_name TEXT NOT NULL DEFAULT '',
          from_email TEXT NOT NULL DEFAULT '',
          from_name TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          template_id TEXT NOT NULL DEFAULT '',
          provider_transmission_id TEXT NOT NULL DEFAULT '',
          provider_message_id TEXT NOT NULL DEFAULT '',
          placement_id BIGINT,
          candidate_id BIGINT,
          client_contact_id BIGINT,
          client_corporation_id BIGINT,
          owner_id BIGINT,
          owner_email TEXT NOT NULL DEFAULT '',
          survey_key TEXT NOT NULL DEFAULT '',
          business_date TEXT NOT NULL DEFAULT '',
          run_date TEXT NOT NULL DEFAULT '',
          sent_at TIMESTAMPTZ,
          text_body TEXT NOT NULL DEFAULT '',
          html_body TEXT NOT NULL DEFAULT '',
          transmission_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          provider_response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_email_transmissions_lookup
        ON workflow_email_transmissions (environment, workflow_name, run_date, sent_at);
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_workflow_email_transmissions_survey_key
        ON workflow_email_transmissions (survey_key, send_type, sent_at);
      `);
    })();
  }

  await ensureSchemaPromise;
  return true;
}

async function query({ config, text, values = [] }) {
  const pool = getPool({ config });
  if (!pool) {
    return { rows: [] };
  }

  await ensureSchema({ config });
  return pool.query(text, values);
}

module.exports = {
  ensureSchema,
  getPool,
  isPostgresEnabled,
  query,
};
