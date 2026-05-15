# Workflow Dashboard

Next.js dashboard for the Sense/Bullhorn workflow Function App metrics.

## Local Development

```bash
npm install
npm run dev
```

Create `.env.local` from `.env.example` and point `WORKFLOW_API_BASE_URL` at the local or Azure Function App API base URL.

```text
WORKFLOW_API_BASE_URL=http://localhost:7071/api
WORKFLOW_API_CODE=
```

The browser calls this dashboard app's internal `/api/dashboard/*` proxy. The proxy calls the Function App server-side, so the Function App key is not exposed to the browser.

## Docker

```bash
docker build -t workflow-dashboard .
docker run -p 3000:3000 --env WORKFLOW_API_BASE_URL=http://host.docker.internal:7071/api workflow-dashboard
```
