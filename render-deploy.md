# Deploying CallRpt AI to Render.com

## Prerequisites
- A [Render.com](https://render.com) account (free tier is sufficient)
- The repository pushed to GitHub

## Steps

### 1. Push the repository to GitHub

```bash
git add .
git commit -m "Add Render deployment configuration"
git push origin main
```

### 2. Create a new Web Service on Render

1. Log in to [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Connect your GitHub account and select the `2026_CallRptAI` repository
4. Render will detect `render.yaml` automatically — click **Apply**

   If prompted to configure manually:
   - **Runtime**: Docker
   - **Dockerfile Path**: `./Dockerfile`
   - **Docker Context**: `.` (repo root)
   - **Plan**: Free

### 3. Set the Anthropic API key

In the Render dashboard for the `callrpt-ai` service:

1. Go to **Environment** tab
2. Add the environment variable:
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: your Anthropic API key (starts with `sk-ant-...`)
3. Click **Save Changes** — the service will redeploy automatically

The `DATABASE_PATH` and `NCUA_DB_PATH` variables are already set in `render.yaml`.

### 4. Persistent disk — database files

The `render.yaml` provisions a 5 GB persistent disk mounted at `/app/data`.

**On first deploy**, the `ncua_callreports.db` file (~24 MB) is baked into the
Docker image from the committed file at `backend/data/ncua_callreports.db`.
However, the Render disk at `/app/data` is empty on first boot, so the app
will NOT find the DB there until you copy it.

**Option A — Copy via Render Shell (recommended for free tier)**

1. In the Render dashboard, open the service's **Shell** tab
2. Run:
   ```bash
   cp /app/backend/data/ncua_callreports.db /app/data/ncua_callreports.db
   cp /app/backend/data/callreports.db /app/data/callreports.db 2>/dev/null || true
   ```
3. The disk persists across all future deploys — you only need to do this once.

**Option B — Re-run ingest on the Render Shell**

```bash
cd /app/backend
python ncua_ingest.py
```

This downloads and rebuilds the NCUA database from source.
Expect it to take several minutes on a free-tier instance.

### 5. Verify the deployment

Once the service is live, visit the Render-assigned URL (e.g.
`https://callrpt-ai.onrender.com`). The React UI should load and the
`/api/health` endpoint should return `200 OK`.

## Architecture notes

- The root `Dockerfile` performs a two-stage build: Node 20 builds the React
  app, then Python 3.11 serves it via FastAPI/uvicorn.
- Static frontend files are served from `/app/frontend/build` by FastAPI.
- Free tier instances sleep after 15 minutes of inactivity; the first request
  after sleep may take ~30 seconds to respond.
- The 512 MB RAM limit on the free tier is sufficient for this workload.
