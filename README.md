# sense-bullhorn-workflows

Minimal Node.js workflow to:

1. Authenticate to Bullhorn.
2. Search recently added candidates (`dateAdded` window).
3. Read candidate phone numbers (`phone`, `mobile`, `phone2`, `phone3`).
4. Infer region from phone number:
   - `+1` numbers use US area code (example: `515` -> `IA`).
   - Non-`+1` numbers use international calling code (example: `+60` -> `MY`).
5. Update `Candidate.address.state` in Bullhorn with the inferred code.

## Important security note

The credentials shared in chat should be treated as compromised. Rotate all Bullhorn `client_secret`, user password, access tokens, and any related secrets before using this in production.

## Local run

1. Copy `.env.example` to `.env`.
2. Fill in your Bullhorn values.
3. Run:

```bash
npm ci
npm run run:workflow
```

`DRY_RUN=true` logs intended updates without writing to Bullhorn.

## Required environment variables

- `BULLHORN_CLIENT_ID`
- `BULLHORN_CLIENT_SECRET`
- `BULLHORN_USERNAME`
- `BULLHORN_PASSWORD`
- `BULLHORN_REDIRECT_URI`

Optional:

- `BULLHORN_AUTH_BASE_URL` (default: `https://rest.bullhornstaffing.com`)
- `BULLHORN_API_BASE_URL` (if your login endpoint differs)
- `BULLHORN_API_VERSION` (default: `*`)
- `LOOKBACK_HOURS` (default: `60`)
- `DRY_RUN` (default: `true`)

## GitHub Actions

Workflow file: `.github/workflows/bullhorn-state-sync.yml`

- Scheduled daily at `02:00 UTC` (10:00 AM Malaysia time, UTC+8).
- Can also run manually with `workflow_dispatch`.

Add repository secrets with the same names as the env vars above.

## Files

- `src/index.js`: Main runner.
- `src/bullhornClient.js`: Bullhorn auth/search/update calls.
- `src/phoneUtils.js`: Phone parsing and mapping logic.
- `src/areaCodeToState.js`: Area-code -> state map.
- `src/callingCodeToRegion.js`: International calling-code -> region map.
