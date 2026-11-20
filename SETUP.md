# Setup & Restore — Run the Project Anywhere

Madina Trading Co. is a full-stack app:
- **Frontend:** React 19 (Create React App via CRACO), TailwindCSS, shadcn/ui
- **Backend:** FastAPI (Python 3.11) + Motor (async MongoDB)
- **Database:** MongoDB

## Repository structure
```
.
├── backend/            # FastAPI app
│   ├── server.py       # all API routes (prefixed with /api)
│   ├── requirements.txt
│   ├── requirements-min.txt   # optional slim runtime deps
│   ├── assets/         # logo used in generated PDFs
│   ├── tests/          # pytest suite
│   └── .env.example
├── frontend/           # React app
│   ├── src/            # pages, components, contexts
│   ├── public/         # index.html, logos, manifest, service worker
│   ├── package.json
│   ├── craco.config.js
│   └── .env.example
├── docs/               # product docs (PRD)
├── ENVIRONMENT.md      # all env variables
├── DEPLOY_RAILWAY.md   # GitHub → Railway deployment guide
├── DATABASE_RESTORE.md # how to import the data dump
└── README.md           # feature overview
```

## Prerequisites
- Python **3.11**
- Node.js **20** and **Yarn 1.x** (`npm i -g yarn`)
- A MongoDB database (local `mongod`, Docker, or MongoDB Atlas)

## A. Run locally

### 1. Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt \
    --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/
#   (the extra-index hosts one Emergent wheel referenced in requirements.txt;
#    if it is unreachable you can instead run:  pip install -r requirements-min.txt)

cp .env.example .env      # then edit .env with your real values (see ENVIRONMENT.md)

# Start the API (binds all interfaces on port 8001):
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```
The API is served under the `/api` prefix, e.g. `http://localhost:8001/api/...`.

### 2. Frontend
```bash
cd frontend
cp .env.example .env       # set REACT_APP_BACKEND_URL=http://localhost:8001
yarn install
yarn start                 # dev server on http://localhost:3000
# production build:
yarn build                 # outputs static site in frontend/build
```

### 3. First login
On first backend startup an Owner account is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
plus a default app PIN. Log in, then change the password and PIN from **Settings → Security**.

## B. Restore the FULL PROJECT BACKUP elsewhere
1. Unzip the full backup — you get the folder shown in *Repository structure* above.
2. Provision a MongoDB and import the data (see **DATABASE_RESTORE.md**).
3. Follow **A. Run locally** (create both `.env` files from the examples).
4. Point `REACT_APP_BACKEND_URL` at wherever the backend is reachable, rebuild the frontend.

That's it — the app restores to the exact state captured in the data dump.
