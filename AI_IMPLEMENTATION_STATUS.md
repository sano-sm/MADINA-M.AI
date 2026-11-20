# Madina Trading AI controls — implementation status

This package is an additive, non-destructive test candidate, **not** a fully functioning AI agent.

Implemented: separately switchable AI and MAI icon buttons in the launcher and authenticated page header, master and per-feature visibility controls, Urdu/English browser speech recognition (where supported), explicit start/stop listening, green active animation, continuous sequential commands while the selected mic remains on, microphone permission/error states, keyboard fallback, cross-page navigation and existing record-search modal, private image preview that is cleared on closing. MAI is enabled by default for new users; external AI and camera remain disabled. Existing backend and database files are not modified by this add-on.

Not implemented: full autonomous browser actions, universal form field filling, customer payment posting, automatic OCR, speech-driven approval and database saves. MAI now uses a backend command gateway for safe read-only routing/search, summary navigation, and permission-checked Vehicle draft opening; write actions still stop at a normal form and confirmation boundary. The backend also includes a company-scoped AI Agent Registry with multiple agents, On/Off state, HTTPS validation, server-side auth environment variable names, connection testing, and a guarded generic JSON message gateway. Camera preview does not upload, extract or save records.

Safety: DO NOT deploy this as a finished universal AI solution. Browser speech recognition can use a browser vendor's service. Local preview does not imply third-party OCR privacy. Before deployment, test all permissions and the browser speech feature in a staging environment. Back up MongoDB separately. Do not run restore scripts on the production database.

To finish universal automation, a developer must integrate authenticated backend tools for each business operation, require owner confirmation on all writes, enforce tenant/company isolation and RBAC, implement provider keys server-side and add integration tests against a staging database. No free usage quota is assumed.
