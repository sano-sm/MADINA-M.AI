# Push to GitHub

This archive is already in **repository-root structure** — the `backend/`, `frontend/`,
and the docs are at the top level (no extra nesting). Extract it and push as-is.

## Option A — GitHub website (no Git needed)
1. Create a new empty repository on GitHub (no README/gitignore — this package includes them).
2. On the repo page: **Add file → Upload files**.
3. Drag in the **contents** of this extracted folder (the `backend/`, `frontend/`,
   `*.md`, `.gitignore` — not a wrapper folder). Commit.

## Option B — Git command line
```bash
cd <extracted-folder>          # the folder that directly contains backend/ and frontend/
git init
git add .
git commit -m "Initial commit — Madina Trading Co."
git branch -M main
git remote add origin https://github.com/<you>/<your-repo>.git
git push -u origin main
```

## Important
- `.gitignore` is included and already excludes `node_modules/`, build output, and **real
  `.env` files**. Only `*.env.example` (placeholders) are committed — never commit real secrets.
- After pushing, follow **DEPLOY_RAILWAY.md** to deploy the backend and frontend services.
