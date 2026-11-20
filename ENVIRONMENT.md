# Environment Variables

No real secrets are included in this repository. Configure the following variables
in each environment. Placeholders are provided in `backend/.env.example` and
`frontend/.env.example`.

## Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `MONGO_URL` | ✅ | MongoDB connection string (Atlas `mongodb+srv://...` or `mongodb://host:27017`). |
| `DB_NAME` | ✅ | Database name the app uses. |
| `JWT_SECRET` | ✅ | Secret to sign JWT auth tokens. Generate: `openssl rand -hex 32`. |
| `ADMIN_EMAIL` | ✅ | Owner account email seeded on first startup. |
| `ADMIN_PASSWORD` | ✅ | Owner account password seeded on first startup. |
| `CORS_ORIGINS` | ⬜ (default `*`) | Comma-separated allowed origins. Set to your frontend URL in production. |
| `EMERGENT_EMAIL_KEY` | ⬜ | Emergent-managed email key for "Forgot PIN" recovery. Works only inside Emergent; leave blank elsewhere. |
| `EMAIL_FROM_NAME` | ⬜ | Sender name used in recovery emails. |

## Frontend (`frontend/.env`) — inlined at BUILD time

| Variable | Required | Description |
|---|---|---|
| `REACT_APP_BACKEND_URL` | ✅ | Public backend base URL, no trailing slash. Must be set before `yarn build`. |
| `WDS_SOCKET_PORT` | ⬜ | Dev-only HMR websocket port. |
| `ENABLE_HEALTH_CHECK` | ⬜ | Dev-only local health-check plugin toggle. |

## Notes
- The app seeds a default Owner account (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`) and a
  default in-app PIN on first boot if none exists. Change these after first login.
- The app supports two companies (MTC and TSK) selected via the `X-Company-Id`
  request header; the frontend sends this automatically. No extra config needed.
