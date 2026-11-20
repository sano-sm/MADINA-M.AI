# Deploy to Railway (GitHub → Railway)

This project is a **monorepo with two apps** (`backend/` and `frontend/`). On Railway you
create **TWO services from the same GitHub repo**, each pointed at its own **Root Directory**.
This is what fixes the earlier "Railpack could not determine how to build/start" problem:
each service now has an explicit **Root Directory + Dockerfile**, so Railway never has to guess.

> The Railway-ready package includes a `Dockerfile` and `railway.json` inside **both**
> `backend/` and `frontend/`. With a Dockerfile present, Railway builds deterministically.

---

## Step 1 — Push to GitHub
Push this repository to GitHub (see the repo README / GitHub steps). The repo root must
contain the `backend/` and `frontend/` folders directly (no extra nesting).

## Step 2 — Provision MongoDB
Use **MongoDB Atlas** (free tier works) or add a Railway MongoDB plugin. Copy its
connection string — you'll use it as `MONGO_URL`.

## Step 3 — Create the BACKEND service
1. Railway → **New Project → Deploy from GitHub repo** → pick this repo.
2. Open the service → **Settings**:
   - **Root Directory:** `backend`
   - **Builder:** Dockerfile (auto-detected from `backend/Dockerfile`).
3. **Variables** (Settings → Variables):
   ```
   MONGO_URL       = <your MongoDB connection string>
   DB_NAME         = madina_trading
   JWT_SECRET      = <output of: openssl rand -hex 32>
   ADMIN_EMAIL     = owner@example.com
   ADMIN_PASSWORD  = <a strong password>
   CORS_ORIGINS    = *        # later set to your frontend URL
   ```
   (`EMERGENT_EMAIL_KEY` / `EMAIL_FROM_NAME` are optional — leave unset off-Emergent.)
4. Railway sets `PORT` automatically; the container binds `0.0.0.0:$PORT`.
   - **Build:** from `backend/Dockerfile`
   - **Start:** `uvicorn server:app --host 0.0.0.0 --port $PORT`
5. Deploy → **Settings → Networking → Generate Domain**. Note the URL, e.g.
   `https://madina-backend.up.railway.app`.

## Step 4 — Create the FRONTEND service
1. In the **same project** → **New → GitHub Repo** → pick the same repo again.
2. Open the service → **Settings**:
   - **Root Directory:** `frontend`
   - **Builder:** Dockerfile (auto-detected from `frontend/Dockerfile`).
3. **Variables**:
   ```
   REACT_APP_BACKEND_URL = https://madina-backend.up.railway.app   # backend URL from Step 3
   ```
   > IMPORTANT: `REACT_APP_BACKEND_URL` is baked in at **build time**. Railway passes
   > service variables to the Docker build automatically. If you change it later,
   > trigger a **redeploy/rebuild** of the frontend.
   - **Build:** from `frontend/Dockerfile` (`yarn install` → `yarn build`)
   - **Start:** `serve -s build -l $PORT` (static server, binds `0.0.0.0:$PORT`)
4. Deploy → **Generate Domain**, e.g. `https://madina-frontend.up.railway.app`.

## Step 5 — Lock down CORS (recommended)
Set the backend `CORS_ORIGINS` variable to the frontend domain and redeploy the backend:
```
CORS_ORIGINS = https://madina-frontend.up.railway.app
```

## Step 6 — Import your data
Restore the database dump into your MongoDB (see **DATABASE_RESTORE.md**).

---

## Summary table

| Service  | Root Directory | Build Command                | Start Command                                   | Key variables |
|----------|----------------|------------------------------|-------------------------------------------------|---------------|
| backend  | `backend`      | Dockerfile (`pip install -r requirements.txt`) | `uvicorn server:app --host 0.0.0.0 --port $PORT` | MONGO_URL, DB_NAME, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, CORS_ORIGINS |
| frontend | `frontend`     | Dockerfile (`yarn install` → `yarn build`)     | `serve -s build -l $PORT`                        | REACT_APP_BACKEND_URL |

## Notes / gotchas
- **Two services, not one.** Do not try to run both apps in a single service.
- **No shell start-script is used anywhere** in this project. Start commands are the ones above.
- Host binding is `0.0.0.0` and the port is `$PORT` (provided by Railway) for both services.
- The frontend is served as a static build via `serve`; there is no Node server to maintain.
- If a build ever fails fetching an Emergent-only dev tool, note the frontend Dockerfile
  already strips `@emergentbase/visual-edits` (dev-only, unused in production builds).
