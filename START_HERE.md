# START HERE — Madina Trading Co. Project Packages

This backup contains everything needed to run, hand over, or deploy the application
independently of the original workspace. Read the doc that matches your goal:

| Your goal | Read |
|---|---|
| Understand features & tech stack | `README.md` |
| Run locally / restore the full project | `SETUP.md` |
| All required environment variables | `ENVIRONMENT.md` |
| Push to a new GitHub repository | `GITHUB_SETUP.md` |
| Deploy GitHub → Railway (2 services) | `DEPLOY_RAILWAY.md` |
| Import the business data (MTC + TSK) | `DATABASE_RESTORE.md` |

## Package layout
```
backend/     FastAPI app (server.py, requirements.txt, assets/, tests/)
frontend/    React app (src/, public/, package.json, craco.config.js)
docs/        Product docs (PRD)
data/        MongoDB dump (only in the FULL backup) — see DATABASE_RESTORE.md
*.md         Setup / deployment / environment / restore guides
```

## Security
No real secrets are included. Configure your own values using `backend/.env.example`
and `frontend/.env.example` (placeholders only). See `ENVIRONMENT.md`.
