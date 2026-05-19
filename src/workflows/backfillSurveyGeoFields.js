require("dotenv").config();

const { loadConfig } = require("../helpers/config");
const { ensureSchema, query } = require("../helpers/postgres");

function buildDummyRegionExpression(seedSql) {
  return `
    CASE mod(abs(hashtext(COALESCE(${seedSql}, ''))), 3)
      WHEN 0 THEN 'Americas'
      WHEN 1 THEN 'EMEA'
      ELSE 'APAC'
    END
  `;
}

function buildDummyCountryExpression(seedSql, apacCountry = "Malaysia") {
  return `
    CASE mod(abs(hashtext(COALESCE(${seedSql}, ''))), 3)
      WHEN 0 THEN 'United States'
      WHEN 1 THEN 'United Kingdom'
      ELSE '${apacCountry}'
    END
  `;
}

async function backfillSurveyTracking({ config }) {
  const seed = "survey_key, row_key, partition_key";
  const dummyRegion = buildDummyRegionExpression(seed);
  const dummyCountry = buildDummyCountryExpression(seed, "Singapore");

  const result = await query({
    config,
    text: `
      WITH prepared AS (
        SELECT
          ctid,
          COALESCE(
            NULLIF(candidate_region, ''),
            NULLIF(metadata_json->>'candidateRegion', ''),
            NULLIF(context_json->>'candidateRegion', ''),
            NULLIF(metadata_json->>'region', ''),
            ${dummyRegion}
          ) AS next_candidate_region,
          COALESCE(
            NULLIF(candidate_country, ''),
            NULLIF(metadata_json->>'candidateCountry', ''),
            NULLIF(context_json->>'candidateCountry', ''),
            ${dummyCountry}
          ) AS next_candidate_country,
          COALESCE(
            NULLIF(assignment_region, ''),
            NULLIF(metadata_json->>'assignmentRegion', ''),
            NULLIF(context_json->>'assignmentRegion', ''),
            NULLIF(metadata_json->>'region', ''),
            ${dummyRegion}
          ) AS next_assignment_region,
          COALESCE(
            NULLIF(assignment_country, ''),
            NULLIF(metadata_json->>'assignmentCountry', ''),
            NULLIF(context_json->>'assignmentCountry', ''),
            NULLIF(context_json->>'country', ''),
            ${dummyCountry}
          ) AS next_assignment_country
        FROM workflow_survey_tracking
      )
      UPDATE workflow_survey_tracking target
      SET
        candidate_region = prepared.next_candidate_region,
        candidate_country = prepared.next_candidate_country,
        assignment_region = prepared.next_assignment_region,
        assignment_country = prepared.next_assignment_country,
        metadata_json = target.metadata_json || jsonb_build_object(
          'candidateRegion', prepared.next_candidate_region,
          'candidateCountry', prepared.next_candidate_country,
          'assignmentRegion', prepared.next_assignment_region,
          'assignmentCountry', prepared.next_assignment_country
        ),
        updated_at = NOW()
      FROM prepared
      WHERE target.ctid = prepared.ctid
        AND (
          target.candidate_region = ''
          OR target.candidate_country = ''
          OR target.assignment_region = ''
          OR target.assignment_country = ''
        )
      RETURNING 1
    `,
  });

  return result.rowCount || 0;
}

async function backfillSurveyResponses({ config }) {
  const seed = "r.survey_key, r.row_key, r.partition_key";
  const dummyRegion = buildDummyRegionExpression(seed);
  const dummyCountry = buildDummyCountryExpression(seed, "Malaysia");

  const result = await query({
    config,
    text: `
      WITH prepared AS (
        SELECT
          r.ctid,
          r.survey_key AS response_survey_key,
          r.row_key AS response_row_key,
          r.partition_key AS response_partition_key,
          COALESCE(
            NULLIF(r.candidate_region, ''),
            NULLIF(r.metadata_json->>'candidateRegion', ''),
            NULLIF(t.candidate_region, ''),
            ${dummyRegion}
          ) AS next_candidate_region,
          COALESCE(
            NULLIF(r.candidate_country, ''),
            NULLIF(r.metadata_json->>'candidateCountry', ''),
            NULLIF(t.candidate_country, ''),
            ${dummyCountry}
          ) AS next_candidate_country,
          COALESCE(
            NULLIF(r.assignment_region, ''),
            NULLIF(r.metadata_json->>'assignmentRegion', ''),
            NULLIF(t.assignment_region, ''),
            NULLIF(r.metadata_json->>'region', ''),
            ${dummyRegion}
          ) AS next_assignment_region,
          COALESCE(
            NULLIF(r.assignment_country, ''),
            NULLIF(r.metadata_json->>'assignmentCountry', ''),
            NULLIF(t.assignment_country, ''),
            ${dummyCountry}
          ) AS next_assignment_country
        FROM workflow_survey_responses r
        LEFT JOIN workflow_survey_tracking t
          ON t.survey_key = r.survey_key
      )
      UPDATE workflow_survey_responses target
      SET
        candidate_region = prepared.next_candidate_region,
        candidate_country = prepared.next_candidate_country,
        assignment_region = prepared.next_assignment_region,
        assignment_country = prepared.next_assignment_country,
        metadata_json = target.metadata_json || jsonb_build_object(
          'candidateRegion', prepared.next_candidate_region,
          'candidateCountry', prepared.next_candidate_country,
          'assignmentRegion', prepared.next_assignment_region,
          'assignmentCountry', prepared.next_assignment_country
        )
      FROM prepared
      WHERE target.ctid = prepared.ctid
        AND (
          target.candidate_region = ''
          OR target.candidate_country = ''
          OR target.assignment_region = ''
          OR target.assignment_country = ''
        )
      RETURNING 1
    `,
  });

  return result.rowCount || 0;
}

async function run() {
  const config = loadConfig();
  if (!config.POSTGRES_CONNECTION_STRING) {
    throw new Error("POSTGRES_CONNECTION_STRING is required to backfill survey geo fields");
  }

  await ensureSchema({ config });
  const trackingRowsUpdated = await backfillSurveyTracking({ config });
  const responseRowsUpdated = await backfillSurveyResponses({ config });

  return {
    trackingRowsUpdated,
    responseRowsUpdated,
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
  backfillSurveyResponses,
  backfillSurveyTracking,
  run,
};
