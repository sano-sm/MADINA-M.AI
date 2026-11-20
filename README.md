# Madina Trading Co. — Business Management System

A complete full-stack business management web application for **Madina Trading Co.**, a vehicle-buying and spare-parts business in Japan. Bilingual (English / Urdu with full RTL), gold/silver/black themed, responsive across iPhone, Android, and MacBook.

## ✨ Features

- **Secure auth** — JWT email/password login with bcrypt hashing.
- **Dynamic role-based access (RBAC)** — Owner / Manager / Accountant seeded; create additional users, roles and permissions from **Settings** (no code changes).
- **App-launcher home** — iPhone-style icon grid, KPI stat bar, alerts badge, quick-add FAB.
- **Vehicles** — records, unique chassis-number search, purchase/sales, full history.
- **Spare Parts** — unified inventory, search, stock quantities, source-vehicle traceability.
- **Dismantle workflow** — one action converts an in-stock vehicle into spare-parts inventory while preserving the vehicle's complete history and cost traceability.
- **Sales & Invoices** — inventory-linked invoices (marks vehicle sold / decrements part stock), `MTC-` prefix, 10% tax, JPY ¥, printable **PDF invoices**; void reverts inventory.
- **Customers** — billed / paid / advance / outstanding balances.
- **Payments** — normal and advance payments applied to invoices; void supported.
- **Expenses, Employees & Salaries.**
- **Reports** — automatic Profit & Loss (with date-range filter), stock valuation, **PDF report**, and **CSV export** (vehicles / parts / customers / invoices).
- **Alerts** — low-stock parts + overdue customer balances.
- **Audit log** — every mutation recorded (user + timestamp + details).
- **Editable company profile** — name, address, phone, email, logo (upload or URL), tax rate, invoice prefix, currency, bank details, invoice footer.

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router, TailwindCSS, shadcn/ui, lucide-react, sonner |
| Backend | FastAPI, Motor (async MongoDB), PyJWT, bcrypt, ReportLab (PDFs) |
| Database | MongoDB |

## 📁 Project Structure

```
/app
├── backend/
│   ├── server.py          # FastAPI app: auth, RBAC, inventory, finance, PDFs, seeding
│   ├── requirements.txt
│   ├── assets/logo.png     # MTC logo (used in PDFs)
│   ├── .env.example
│   └── .env               # (not committed — see .env.example)
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   ├── pages/          # Launcher, Vehicles, Parts, Customers, Finance, Reports, Alerts, Settings, Audit, Login, Dashboard
│   │   ├── context/        # AuthContext, I18nContext (en/ur + RTL), SettingsContext
│   │   ├── components/      # Layout, kit (UI), ui/ (shadcn)
│   │   └── lib/api.js       # axios instance (Bearer token, download helpers)
│   ├── package.json
│   ├── .env.example
│   └── .env               # (not committed — see .env.example)
└── README.md
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and **Yarn**
- Python 3.11+
- A running MongoDB instance

### 1. Environment variables
Copy the examples and fill in your own values:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### 2. Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001
```
On first startup the app auto-seeds the **Owner** account, the **Owner/Manager/Accountant** roles, and the **company profile** from your env values.

### 3. Frontend
```bash
cd frontend
yarn install
yarn start
```

The frontend calls the backend via `REACT_APP_BACKEND_URL`. All backend routes are prefixed with `/api`.

## 🔑 Default Login
Set by `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env`. Example:
- Email: `owner@example.com`
- Password: *(your chosen ADMIN_PASSWORD)*

The app opens in **Urdu (RTL)** by default; toggle to English anytime.

## 🌐 API Overview (prefix `/api`)
- `POST /auth/login`, `GET /auth/me`
- `GET/PUT /settings`, `GET/POST/PUT/DELETE /users`, `GET/POST/PUT/DELETE /roles`, `GET /permissions`
- `GET/POST/PUT/DELETE /vehicles`, `POST /vehicles/{id}/dismantle`
- `GET/POST/PUT/DELETE /parts`
- `GET/POST/PUT/DELETE /customers`
- `GET/POST/DELETE /invoices`, `GET /invoices/{id}/pdf`
- `GET/POST/DELETE /payments`
- `GET/POST/DELETE /expenses`, `GET/POST/DELETE /employees`, `GET/POST /salaries`
- `GET /reports/pnl` (`?start=&end=`), `GET /reports/stock`, `GET /reports/pnl/pdf`
- `GET /export/{vehicles|parts|customers|invoices}` (CSV)
- `GET /alerts`, `GET /dashboard`, `GET /audit`
- `GET/POST/PUT/DELETE /ai-agents`, `POST /ai-agents/{id}/test`, `POST /ai-agents/{id}/message` (Settings Manager permission; HTTPS endpoints only)
- `POST /mai/command` (permission-checked MAI routing/search and safe draft navigation)

> PDF and CSV download endpoints also accept the JWT via `?token=` for direct browser links.

## 🏦 Business Defaults
Currency **JPY (¥)** · Tax **10%** · Invoice prefix **`MTC-`** · Address *781-1153, Kochi-ken, Tosa-shi, Tsukaji 1013-2, Japan* · Tel *090-1570-0433* · Email *MTC.jp09@gmail.com* — all editable in **Settings**.

## 📝 License
Proprietary — © Madina Trading Co.
