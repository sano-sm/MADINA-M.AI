# Madina Trading Co. — Business Management System (PRD)

## Original Problem Statement
Full-stack business management web app for Madina Trading Co. (Japan vehicle-buying + spare-parts business). Responsive (iPhone/Android/MacBook). Bilingual English/Urdu with RTL. Secure login, shared dashboard, cloud DB, dynamic RBAC (Owner/Manager/Accountant + custom roles/permissions from Settings). Connected Vehicles + Spare Parts unified inventory with chassis search, purchase/sales records, stock valuation, one-action dismantle-vehicle-to-parts workflow preserving history + cost. Customer payments, outstanding balances, advances, expenses, employee salaries, automatic P&L, invoice printing, PDF reports, shared reporting, audit history. Default JPY, 10% tax, invoice prefix MTC-, preloaded company address/phone/email — all editable from Settings.

## Architecture
- Backend: FastAPI (`/app/backend/server.py`), MongoDB (motor, uuid string ids), JWT Bearer auth + bcrypt, ReportLab PDFs. All routes `/api`. PDF/CSV downloads also accept `?token=` query.
- Frontend: React 19 + craco, Tailwind, custom kit + shadcn, sonner toasts, react-router. Contexts: Auth, I18n (en/ur + RTL, default Urdu), Settings (company profile + money formatter).
- Theme: Gold #D4AF37 / Silver #C0C0C0 / Black dark theme, MTC logo, Chivo/IBM Plex/Noto Sans Arabic fonts.
- Home = iPhone-style app launcher (approved) with KPI stat bar, alerts badge, quick-add FAB, bottom tab bar. Dashboard KPIs at /dashboard.

## User Choices
- JWT email/password auth; single Owner seeded (owner@example.com / ChangeMe_SetInEnv).
- Backend PDFs. Default language Urdu (RTL). Gold/silver/black branding + uploaded MTC logo.

## Recovery + Stock + Profit/Loss Accounting Upgrade (2026-06 — verified iteration_12, backend 78/78, FE 100%)
- **Three vehicle-first recovery categories** — Engine, H/Cut, Parts — all via `POST /api/part-sales` with a `category` field. Each: select dismantled source vehicle → record (Date, Name/Code/Description, To, Sale Amount); permanently linked, adds to that vehicle's Total Recovered, recalculates Remaining Cost & Profit/Loss, and flows into monthly/yearly sales by category (no double-count), PDF/CSV/JSON. `compute_recovery.engine/half_cut` = tracked sold + part_sales(category); parts = part_sales(parts). Category defaults to 'parts' (backward-compat); validation blocks non-dismantled source & over-received amounts.
- Vehicle Original Purchase Price immutable; recovery shows Engine/H-Cut/Parts/Scrap/Shokubai + Total Recovered/Remaining/Profit-Loss.
- Standalone direct engine/half-cut purchases keep their own workflow (Recovery "Standalone Stock" collapsible + Add Engine/Half Cut); still searchable/sellable, duplicate-sale blocked.
- Scrap now attributes to its selected month (frontend no longer sends an overriding today-date; backend defaults date to `month-15`). Scrap/Shokubai remain pooled allocations counted once.
- **Stock-aware accounting** in summarize: Purchases breakdown (vehicle/standalone eng-hc/spare parts/total), Sales by category, Cash (received/balance due), Opening & Closing Stock at COST, COGS = Opening + Purchases − Closing, Net Profit = Sales − COGS − Expenses (unsold stock no longer counted as profit/loss). Point-in-time stock via `stock_value_asof`/`recovered_asof`; `compute_stock_valuation` now includes in-stock vehicles + standalone engines/half cuts + spare parts + dismantled remaining unrecovered cost.
- No double-count: scrap/shokubai counted once as a sale; per-vehicle allocation is attribution only. Scrap allocation date now defaults to its accounting month (`month-15`).
- Frontend: Recovery **Parts tab** (vehicle search + Sell Part modal); Summary page grouped into Purchases/Sales/Cash/Stock&Accounting; Vehicle detail shows Parts recovery line. Compact landscape PDFs gained a Parts Sales (vehicle-linked) section + full accounting summary.


## Implemented (2026-06)
- Auth + dynamic RBAC (Owner/Manager/Accountant seeded; create users/roles/permissions from Settings). Route-level + API permission guards.
- Company Settings fully editable (name/address/phone/email/logo(upload data-URL or URL)/tax/prefix/currency/symbol/bank details/invoice footer); MTC defaults preloaded.
- Vehicles CRUD + unique chassis search + detail (history & derived parts). Purchases recorded on vehicle create.
- One-action dismantle (vehicle -> parts, source_chassis + cost traceability, status=dismantled).
- Spare Parts CRUD + search (unified inventory, source vehicle link).
- Customers with billed/paid/advance/outstanding balances + detail.
- Invoices (inventory-linked vehicle/part/custom items, MTC- prefix, 10% tax, marks sold / decrements stock) + PDF. Void invoice reverts inventory.
- Payments (normal + advance, applied to invoices) + void payment.
- Expenses, Employees + Salaries.
- Automatic P&L (revenue/COGS/gross/expenses/salaries/net + tax) with date-range filter + Stock Valuation + PDF report + CSV export (vehicles/parts/customers/invoices).
- Alerts (low-stock parts + overdue balances) page + launcher badge. Dashboard KPIs incl. today's sales/payments.
- Audit log (all mutations). Bilingual EN/UR with full RTL, responsive.
- Performance: bulk aggregation queries + field projections; indexes on users.email(unique), vehicles.chassis_number(unique), invoices.created_at, payments.created_at, parts.quantity.

## Master Upgrade (2026-06 — verified iteration_8, 51/51 backend pass, 100% FE smoke)
- Vehicle engine fields (engine_code/engine_number), purchase_date vs dismantle_date separation.
- Dismantle creates tracked Engine + Half Cut records (special recovery items); double-dismantle blocked.
- Complete-vehicle sale route (mutually exclusive with dismantle); recovery blocks/allows correctly.
- Tracked-parts search & sale (sold items stay searchable, cannot re-sell).
- Scrap allocation by Dismantle Date (per-month, duplicate-blocked, reversible via records.reverse).
- Shokubai allocation using prev cut-off -> new cut-off, excludes already-allocated vehicles.
- Vehicle recovery computation (recovered value, remaining, profit/loss).
- Monthly/Yearly summaries (JSON) + Today/Monthly/Yearly PDF reports (`/api/reports/{today,monthly,yearly}/pdf`, ?token= auth).
- customer_balance + compute_balances_bulk now include engine/half-cut & complete-vehicle sales (received-vs-due fix).
- CSV export expanded to 10 entities + one-click full JSON backup (`/api/export/backup`, all 14 collections).
- 13th permission `records.reverse` (Owner-only sensitive corrections/reversals) + audit history.
- Frontend: Recovery/Allocations/Summary pages + launcher tiles; Reports page export/PDF/backup UI; PWA (manifest name/short_name "MTC", MTC logo icons, service worker, apple meta).

## Testing
- Backend 51/51 pytest pass (iteration_8, xdist -n 2 loadscope). Frontend UI smoke 100% (Urdu RTL + EN toggle, mobile launcher). Prior 35/35 iteration_7.
- Bugs fixed & verified: customer balance now counts tracked/complete sales (iter_8); data-URL logo PDF crash (temp-file for RLImage), report PDF `?token=` auth, launcher today_sales.
- Open code-review suggestions (non-blocking): split server.py into routers; dedupe balance filter loops; scrap month range uses lexicographic `-31` (works, but 2026-02-31 pattern would match).

## State
- Production/business data PRESERVED — no resets/deletes performed. Tests use ephemeral TEST_-prefixed records cleaned up in finally blocks.

## Workflow Simplification (2026-06 — verified iteration_10, backend 62/62, FE 100%)
- Compact vehicle purchase form: primary = Purchase Date, Vehicle Name, Chassis, From, Purchase Amount; make/model/engine/year/color/mileage/notes under collapsible "More Details". Vehicle model gained `vehicle_name`; make/model now optional (existing data preserved).
- Dismantle Vehicle: modal asks only Dismantle Date; backend auto-creates one engine tracked part (create_engine default true); double-dismantle & sold_complete blocked; dismantle_date separate from purchase_date; owner date-correction with audit.
- Direct Engine/Half Cut purchase: new POST /api/tracked-parts (source='direct', no chassis/source needed) + "Add Engine / Half Cut" button/modal on Recovery. Sellable, duplicate-sale blocked, cost in `engine_halfcut_purchases`, included in reports/PDF/CSV/backup.
- Compact Spare Part form: Date, Part Name, Qty, Unit Cost, Sale Price, From; part_number/category/location under "More Details". Part model gained `purchase_date` + `supplier`.
- Short From/To labels applied to vehicles/parts/engine/half-cut/sales.
- Compact landscape multi-page PDF reports (Today/Monthly/Yearly = one file each): header once + summary + row-level tables (Vehicle Purchases, Spare Parts, Direct Eng/HC Purchases, Complete Sales, Engine/HC Sales, Scrap, Shokubai).
- CSV parts (+purchase_date,supplier) and tracked_parts (+date,name,source,supplier,purchase_price) columns expanded.


## Mobile Responsiveness (2026-06 — verified iteration_9, FE 100%)
- Added reusable `DataTable` + `useIsMobile` hook in `components/kit.js`: renders a real `<table>` on desktop (≥768px) and stacked label/value cards on mobile (<768px). Only one layout is in the DOM at a time, so `data-testid`s are never duplicated.
- Migrated all wide list tables to `DataTable`: Vehicles, Parts, Customers, Recovery, Allocations (scrap+shokubai), Finance (invoices/payments/expenses).
- Verified at 390px: NO horizontal page overflow on /vehicles /parts /customers /finance /recovery /allocations /reports /dashboard /settings /audit (scrollWidth==innerWidth). Black/gold RTL design preserved, text not shrunk. Desktop stays table-based.

## Changelog — 2026-08-09 (Phase 1: Stability & persistent login + Phase 2: Multi-company backbone)
### Phase 1 (done, verified)
- Persistent login: JWT lifetime 7d → **365d** + `token_version` claim; `/auth/refresh` slides the session on each app open (AuthContext). Password change bumps `token_version` (invalidates old sessions). User stays logged in until Logout / password change.
- Frontend `api.js`: auto-reconnect with backoff + "Reconnecting…" toast on network/502/503/504 (backend sleep) — no false logout; only genuine 401 logs out. Sends `X-Company-Id` header + `company` on download URLs.
- Launcher app order fixed permanently to requested priority (Vehicles, Spare Parts, Purchases, Sales, Expenses, Recovery, Allocations, Summary, Stock → then Customers, Payments, Reports, Users, Settings, Alerts).
- LIMITATION: preview container sleeping ("Preview Unavailable/Resume") is a hosting behavior; mitigated via auto-retry but only fully removed on the deployed app.

### Phase 2 (done, verified)
- Multi-company (MTC + TSK) via ContextVar + `ScopedDB`/`ScopedCollection` wrapper: every per-company collection query auto-injects `company_id`; inserts auto-stamp it. Company chosen by `X-Company-Id` header (default MTC), set by middleware.
- Per-company collections: vehicles, parts, tracked_parts, part_sales, customers, invoices, payments, expenses, employees, salaries, scrap_allocations, shokubai_allocations, audit_logs, (+ future brokers/loans). Global: users, roles. Settings now per-company (`id="company:MTC"|"company:TSK"`).
- SAFE additive startup migration: stamped all existing records `company_id="MTC"` (no deletes); migrated legacy settings→company:MTC; seeded TSK settings (Towa Shokai Corp, blank prefix, /logo-tsk.png). Chassis uniqueness now per-company compound index.
- Frontend: `CompanyContext` + `CompanySwitcher` in global header — MTC/TSK pills with logo + short name + GREEN active dot / gray inactive; one click reloads entire app to the selected company (no re-login). TSK logo saved to public/logo-tsk.png.
- Verified: MTC 7 vehicles preserved; TSK isolated (0); create-in-TSK not visible in MTC; per-company settings correct; **full backend suite 83/83 passed** after scoping; switcher UI confirmed by screenshot.

### P3/P5/P6 — Stock, Purchases, PDFs, Broker linking, full regression (DONE & testing-agent verified — iteration_13)
- **Stock page** (`/stock`): current inventory at COST for both companies (in-stock vehicles, available parts, standalone engines/hcuts, dismantled remaining, total stock value). Uses `/api/reports/stock` (company-scoped).
- **Purchases page** (`/purchases`): month/year purchase summary (vehicle/standalone/parts + total) with counts, purchase COST only. Uses `/api/reports/monthly|yearly`. Compact per-month purchase boxes added to Vehicles & Parts pages.
- **PDF no-clip**: `build_summary_pdf` section() now scales column widths to the usable landscape width and wraps text cells in Paragraphs — verified via rendered PNGs that the wide 7-column Recovery Sales table (prev. NZE121 clip) shows all columns/amounts. PDF filenames are company-prefixed.
- **Broker Pending → Received in ONE step**: `POST /api/vehicles` accepts `broker_vehicle_id`; on create it marks that broker vehicle received + links `vehicle_id`, with NO duplicate purchase (exactly one vehicle row). UI: optional "Link Broker Pending Vehicle" selector in Add Vehicle (in More Details).
- **Backup/Export company-aware**: `/export/backup` and `/export/{entity}` scoped by company + company-aware filenames (was leaking across companies — fixed).
- **Testing-agent iteration_13**: 18/18 new multi-company tests PASS; full backend suite green after fixing a fragile pre-existing `test_pnl_date_range` (now delta-based). Confirmed: company isolation, tax-inclusive, broker one-step link, loans, recovery-complete, stock, purchases, PDFs (both companies), backups, Finance 2-tabs, 404 sweep clean, persistence. Fixed a critical missing `PurchaseBox` import in Vehicles.js (found+fixed).

### P3 module repurposing + P4 business logic (DONE & verified this session)
- **Brokers / Suppliers** (new module): full backend (profiles, pending/received vehicles, broker payments) + frontend page. Account math verified: purchases−paid = due; overpay = advance; pending→received transition; MTC/TSK isolated. Route `/brokers`.
- **Loans / Udhaar** (new module, repurposes Reports): backend (profiles + entries borrowed/lent/repayment/received_back + balance) + frontend page. Balance verified (i_owe/receivable/net). Route `/loans`.
- **Recovery Completed / All Parts Sold**: `POST /vehicles/{id}/recovery-complete` sets `recovery_status=completed`; recovery source search now returns only OPEN dismantled vehicles; all records/purchase price preserved. Vehicles detail shows button (owner-editable) / completed badge. Verified via curl.
- **Finance repurposed**: tabs trimmed to **Invoices (Sales) + Expenses only** (Payments/Employees tabs removed — Payments superseded by Brokers). Invoice form gained editable **Sale Date** + tax-inclusive hint.
- **Tax-inclusive invoicing** (new invoices only): verified ¥110k→100k+10k; customer billed uses tax-inclusive total. Editable sale_date drives created_at/summary.
- **Launcher**: added Brokers + Loans tiles; removed old Payments/Reports tiles.
- **Backup/Export isolation fix**: `/export/backup` and `/export/{entity}` were using raw db (leaked across companies) — now company-scoped with company-aware filenames. Verified MTC vs TSK counts differ correctly.
- Full backend suite **83/83 passed** after all changes (invoice tests updated to tax-inclusive expectations).

### STILL REMAINING (not built/verified yet)
- Dedicated **Purchases summary** page + **Stock** page (backend data exists: summarize + /reports/stock) — launcher tiles currently point to /vehicles and /reports.
- Compact per-period purchase total boxes on Vehicles / Parts / standalone.
- Broker pending-vehicle → Vehicles linking UI from the Vehicles side (backend receive endpoint accepts vehicle_id; no picker UI yet).
- Detailed Salary expense fields (person/date) — currently via category+description.
- Landscape / no-clip Today/Monthly/Yearly PDFs (P5).
- Full MTC+TSK end-to-end regression via testing_agent (P6).

### REMAINING (not yet built — P3–P6)
- P4 tax-INCLUSIVE invoicing: **DONE & verified** — entered price includes tax; create_invoice computes before_tax = total/(1+rate), included_tax = total-before_tax; applies to NEW invoices only (existing untouched). Editable `sale_date` added (defaults today; used for created_at/summary/history). Verified: ¥110,000 → 100,000 + 10,000 tax; customer billed 110,000.
- P3 module repurposing: Sales-only Finance, Expenses (Salary/Other only), Payments→Brokers/Suppliers (profiles, pending/received vehicles, broker payments/advance), Reports→Loans/Udhaar, Purchases summary page, Stock view.
- P4 business logic: broker pending/received linking + double-count protection, Recovery Completed/All-Parts-Sold, tax-INCLUSIVE invoice pricing (new invoices only), customer Payment Due/Balance labels, stock-aware COGS review.
- P5: landscape/no-clip Today/Monthly/Yearly PDFs + company-aware backup/export.
- P6: full MTC+TSK regression, isolation, accounting, persistence tests.

## Changelog — 2026-08-08 (Vehicle status mutual exclusivity + complete-sale display)
- Vehicle statuses are strictly one of In Stock / Sold Complete / Dismantled. Backend enforces: dismantle only from in_stock; complete sale (`/sell`) only from in_stock; sold-complete & dismantled excluded from Engine/H-Cut/Parts recovery, Scrap and Shokubai allocations (all filter `status=="dismantled"`).
- Fixed false-loss bug: `GET /vehicles/{id}` no longer attaches the dismantle `recovery` panel to sold-complete or in-stock vehicles. Sold-complete now returns a `sale_summary` (purchase, sale, sold_to, sale_date, amount_received, balance_due, profit_loss). In-stock returns neither (no phantom "remaining to recover / loss").
- Frontend Vehicles detail renders `sale-summary-panel` for sold vehicles and `recovery-panel` only for dismantled. Status label shows "Sold Complete" for both legacy invoice `sold` and `sold_complete` (i18n `sold_to`/`sale_date` added, en+ur).
- Note: invoice-sold vehicles keep status `sold` (revenue already counted via invoice) — displayed as "Sold Complete" but without the received/balance summary to avoid double-counting.
- Tests: new `TestVehicleStatusExclusive` (3 cases A/B/C) + updated 2 legacy tests to the new contract. Full backend suite **83/83 passed**. Frontend labels + detail verified via screenshot.

## Changelog — 2026-08-08 (Spare Parts search + accounting audit)
- Fixed Spare Parts inventory search: `/api/parts` `$or` now matches name, part_number, **supplier ("From")**, category, location, source_chassis (previously supplier/category/location were not searchable → search-by-From returned nothing).
- Audited "Add Part counted as sales" report: reproduced with isolated records — backend `summarize` counts parts sales ONLY from invoices + recovery part_sales; Add Part inventory affects `parts_purchases`/`closing_stock` at cost, never `parts_sales`/`total_sales`/`received`. Preview backend already correct; if seen live, redeploy the current backend.
- Added regression tests in `TestParts`: `test_search_by_all_fields`, `test_add_part_not_counted_as_sales`. Full backend suite: 80/80 passed. Mobile Parts page 390px: no overflow.

## Backlog / Future (P1/P2)
- P1: Quick-add menu could open create modals directly (currently navigates).
- P2: Monthly P&L charts; multi-currency conversion; password reset + brute-force lockout (playbook available); serialize snapshot-sensitive tests.

## Test Credentials
Owner: owner@example.com / ChangeMe_SetInEnv (see /app/memory/test_credentials.md)


## Final Verification Pass — Items 1–10 (2026-06, verified iteration_14 + backend 101/101)
- **Spare-parts accounting fix (items 5 & 8)**: `create_part` persists immutable `purchased_quantity`; `summarize()` now computes `parts_purchases` from `purchased_quantity` (fallback `quantity`) so Total Purchases NEVER decreases after a sale. Sales use the tax-inclusive entered `total` (actual amount entered) = the customer's amount; COGS = actual cost (opening+purchases−closing); Gross = Sales−COGS; tax reported separately and does NOT distort Purchase Cost/COGS/Gross/Stock/Net. Verified isolated case for BOTH MTC & TSK: buy ¥100k → sell ¥110k ⇒ purchases stable ¥100k delta, sales +¥110k, COGS +¥100k, gross +¥10k; sold part remains in history (qty 0 / purchased_qty 1); invoice persists.
- **Vehicle search (item 3)**: `list_vehicles` `$or` now matches `vehicle_name` + `engine_name` in addition to chassis/make/model/engine_code/engine_number. Live-verified all 5 fields return the record. Bottom-bar Search opens the Vehicles page (intended; no separate /search route).
- **Add Vehicle form**: added `engine_name` input (data-testid `v-engine-name`) + i18n key `engine_name` (EN/UR) so Engine Name is enterable and end-to-end searchable.
- **Fragile test fix**: `test_pnl_date_range` rewritten to use an isolated future date (2099-06-15) and the tax-inclusive sales expectation (immune to xdist parallel interference).
- **iteration_14 (frontend E2E)**: items 1,2,3,4,7,9,10 all PASS — persistent login/reload, Vehicles CRUD, bottom Search, broker one-step link (no duplicate; broker→received), customer partial-payment balances, PDFs render no-clip (verify-only), MTC/TSK isolation with clean switcher. All TEST_FINAL_ records cleaned; no MTC business data touched.
- Known non-blocking: Add Vehicle uses native date input; dev-mode React `<span> in <option>` warning (instrumentation only). PDFs unchanged per user instruction.

## Persistent Login + 404 Fix (2026-06 — TOP PRIORITY, frontend resilience)
- ROOT CAUSE 404: sleeping/cold-starting preview backend returns a transient GATEWAY 404 (non-JSON, no `detail`) for POST /auth/login; api.js previously retried only 502/503/504+network, so the 404 surfaced as "Request failed with status code 404".
- ROOT CAUSE auto-logout: AuthContext called /auth/me on load and cleared the token on ANY error (incl. transient sleep/404), bouncing valid sessions to /login.
- FIX api.js: retry transient errors incl. OPAQUE 404 (non-JSON body) up to 10x w/ backoff (cap 5s); JSON `{detail}` 404s (real API 404) are NOT retried. Session cleared ONLY on definitive 401.
- FIX AuthContext.js: cache last-known user in localStorage (mtc_user); optimistic restore on open so a sleeping backend never bounces to /login; verify /auth/me in background; clear token+cache ONLY on 401.
- Backend unchanged (already 365-day JWT + token_version + /auth/refresh). Tests added to TestAuth: long-lived token (>=300d), refresh slides session, refresh unauth=401, unknown route returns JSON 404. Verified: 6x repeated logins all 200; reload + deep-route keep session; wrong password shows clean 401.

## App PIN Lock (2026-06 — replaces daily password login)
- App opens to a PIN screen (PinLock.js) -> correct PIN -> Dashboard. Password login kept only as fallback ("Sign in with password") + recovery.
- Backend: bcrypt `pin_hash` on Owner; endpoints /auth/pin/status|verify|set|forgot|reset; brute-force lockout 5/15min; default Owner PIN seeded 0433 (idempotent, never overwrites existing).
- Forgot PIN: Resend (Emergent-managed) emails a 6-digit code to Owner email; reset sets new pin_hash + returns session. Env: EMERGENT_EMAIL_KEY, EMAIL_FROM_NAME. httpx send per playbook (from_name required).
- Frontend: on-device PBKDF2 hash in localStorage (mtc_pin) for OFFLINE unlock (no login API each open). AuthContext: local mode (offline verify of cached session) vs server mode (first unlock via /auth/pin/verify, then caches token+user+local hash). Settings > Security tab to change PIN.
- CRITICAL fix during build: SettingsProvider now mounts only after unlock+auth (Gate), and the api.js 401 handler redirects only when a token existed — previously /api/settings 401 during the PIN screen force-redirected to /login.
- Verified: fresh open->PIN->dashboard; wrong PIN shows "Incorrect PIN" (no redirect); reopen->PIN->dashboard; backend pin endpoints + email 202.

## Reconnect Stability Fix (2026 — frontend-only, no data/logic change)
- ROOT CAUSE: the "Reconnecting…" toast was only dismissed on a SUCCESSFUL response; when retries exhausted and rejected (backend slept while idle/backgrounded), the toast stayed stuck forever and pages showed empty/zero. Nothing re-pinged or refetched on reopen.
- FIX api.js: dismiss the spinner on give-up (hideReconnecting); track disconnected flag; on the first success after a disconnect, show "Reconnected" and dispatch window event "mtc:reconnected".
- FIX AuthContext.js: reconnect manager on visibilitychange/focus/online quickly re-pings /auth/pin/status ({__noRetry}) every 1.5s (up to ~12s) until reachable; exposes reconnectKey bumped on "mtc:reconnected".
- FIX App.js Gate: <SettingsProvider key={reconnectKey}> remounts the app subtree after a real reconnect so every page re-runs its mount fetch and records reload automatically. Normal tab switches do NOT remount (only after an actual disconnect).
- Verified via network-block simulation: disconnected -> "Reconnecting…" + empty list; reopen events -> "Reconnected", 4x successful /api/parts, list reloaded with real data. PIN system unchanged.

## Dashboard Visual Redesign (2026 — VISUAL ONLY, awaiting user approval)
- Redesigned Launcher.js to match provided reference: premium black/gold, top utility bar (menu + EN/UR lang pills + MTC/TSK CompanySwitcher + search), centered brand header, 4 top stat cards, Quick Access icon grid (EN+UR labels, alerts badge, added Container & TT tile -> "coming soon" toast placeholder, module NOT built yet), Business Overview (This Month/This Year) 5 cards, Monthly Sales bar chart (last 8 months), Recent Activities (audit), Reminders & Alerts, app-style bottom bar (Home/Activity/FAB/Container&TT/Logout).
- Data from EXISTING endpoints only (/dashboard, /reports/monthly, /reports/yearly, /alerts). NO backend/API/DB/business-logic changes.
- App.js: home route "/" now renders BARE (Protected bare -> no Layout sidebar/topbar) to match the full-screen reference and remove duplicate top bars. All other routes keep Layout unchanged. Navigation preserved via Quick Access + hamburger menu + bottom bar.
- Added i18n keys (EN/UR): quick_access, business_overview, customer_balance, monthly_sales_overview, recent_activities, view_all, reminders_alerts, container_tt, coming_soon, this_year, payment_overdue, total_sales.
- Verified: mobile(390) no h-overflow, desktop(1440) clean; all Quick Access tiles + hamburger menu + lang toggle + company switcher + bottom Activity + FAB quick-add navigate correctly. Awaiting approval before next feature.

## Customer Sales History Enrichment (2026-06 — read-only display, verified)
- GET /api/customers/{cid}: enriches each invoice item (item_name from description/vehicle/part; chassis_number + engine_number for vehicle lines from vehicles collection; source_chassis for part lines) and adds `tracked_sales` (engine/half-cut sales stored on tracked_parts, filtered by sale_price). Company-scoped via `sdb`. NO writes/migrations; balances/payments/invoice math untouched.
- Customers.js detail modal: shows per invoice — Sale Date, Invoice No, item rows (name + chassis/engine when present), Sale Amount (total), Paid, Balance badge; invoice total shown ONCE (multi-item invoices list items without duplicating totals). Separate rows for engine/half-cut tracked sales. Summary cards (billed/paid/advance/outstanding) unchanged.
- Verified on real MTC customer "UAE": all 8 fields render (Sale Date, Invoice No, Item, Chassis HA23S/Nhp10, Engine K6A, Sale Amount, Paid, Balance ¥15,000 red); tracked engines 2ZR/1kz shown; balances match existing accounting; no duplication. Backend curl + live PIN-unlock screenshot both pass.

## Container & TT Module (2026-06 — NEW, isolated, tested)
- New route /container (perm finance.view) with 3 tabs: Container Invoice, Income TT, Container & TT Summary. Launcher tile app-container_tt now navigates here (was "Coming soon").
- ISOLATION: two NEW per-company collections `container_invoices` + `income_tt` (added to PER_COMPANY_COLLECTIONS, scoped via sdb). Linked ONLY to each other via invoice_number. Does NOT read/modify vehicles, parts, sales, customers, brokers, expenses or any P&L. Verified: dashboard + customer balances unchanged after creating container/TT data.
- Backend: GET/POST /container-invoices, GET/PUT/DELETE /container-invoices/{id}; GET/POST /income-tt, PUT/DELETE /income-tt/{id}; GET /container-tt/summary. _ci_total = sum(item prices); _tt_status: due=max(0,cnr-cum), over=max(0,cum-cnr), mutually exclusive; status unpaid/partial/paid/overpaid.
- Container Invoice UI: dynamic (+ New Container Invoice), compact searchable invoice cards, A4 white-paper sheet (bg-white/text-black, .ci-paper 210mm), centered bold company name, compact left/right editable header (loading_date, container_no, invoice_no, final_destination, bl_surrender_date). Two-sided full-bordered item grid 1-30 | 31-60 (No|Item|Price ×2); Add Page for 61-120, 121-180... Invoice Total auto-sums all pages. Print button uses @media print (only #ci-print-area, A4 @page).
- Income TT: continuous ledger (Date|From|Container No|Invoice No|CNR Amount|Income TT Amount|Over/Due+status). Select Invoice No -> auto-fills From/Container/CNR (invoice total); user enters only TT date + amount. Multiple TT per invoice accumulate; per-invoice due(red)/over(blue) + status badge.
- Summary: 4 cards (Total Container Invoice Amount, Total Income TT Received, Total Due, Total Over) — Due and Over kept SEPARATE (both can be >0 across invoices).
- i18n EN+UR keys added. Verified iteration_17.json: 10/10 backend, 100% frontend, isolation confirmed. Regression test: /app/backend/tests/test_container_tt.py.
