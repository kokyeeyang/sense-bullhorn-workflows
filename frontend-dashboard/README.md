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

Build the dashboard image from this `frontend-dashboard` directory:

```bash
docker build -t workflow-dashboard-local .
```

Run it against a local Azure Functions backend:

```bash
docker run --rm -p 3002:3000 \
  -e WORKFLOW_API_BASE_URL=http://host.docker.internal:7071/api \
  workflow-dashboard-local
```

On PowerShell, use backticks for line continuation:

```powershell
docker run --rm -p 3002:3000 `
  -e WORKFLOW_API_BASE_URL=http://host.docker.internal:7071/api `
  workflow-dashboard-local
```

Run it against an Azure Function App:

```powershell
docker run --rm -p 3002:3000 `
  -e WORKFLOW_API_BASE_URL=https://<function-app-name>.azurewebsites.net/api `
  -e WORKFLOW_API_CODE=<function-key> `
  workflow-dashboard-local
```

Save the image to a portable tar file:

```bash
docker save -o workflow-dashboard-local.tar workflow-dashboard-local
```

Load a saved image:

```bash
docker load -i workflow-dashboard-local.tar
```

Delete local containers/images when you no longer need them:

```bash
docker ps -a
docker stop <container-id-or-name>
docker rm <container-id-or-name>
docker rmi workflow-dashboard-local
docker image prune
```

Push to Azure Container Registry:

```bash
docker login <registry-name>.azurecr.io
docker tag workflow-dashboard-local <registry-name>.azurecr.io/workflow-dashboard-local:latest
docker push <registry-name>.azurecr.io/workflow-dashboard-local:latest
```

Example with the current ACR naming pattern:

```bash
docker login sosenseworkflowacr-fhdxbrc8hdc7fgbv.azurecr.io
docker tag workflow-dashboard-local sosenseworkflowacr-fhdxbrc8hdc7fgbv.azurecr.io/workflow-dashboard-local:latest
docker push sosenseworkflowacr-fhdxbrc8hdc7fgbv.azurecr.io/workflow-dashboard-local:latest
```

Delete the local ACR-tagged copy after pushing:

```bash
docker rmi sosenseworkflowacr-fhdxbrc8hdc7fgbv.azurecr.io/workflow-dashboard-local:latest
```

Delete an image from Azure Container Registry with Azure CLI:

```bash
az acr repository delete \
  --name sosenseworkflowacr-fhdxbrc8hdc7fgbv \
  --image workflow-dashboard-local:latest \
  --yes
```

Do not commit Function keys, registry passwords, or `.env.local` values.
