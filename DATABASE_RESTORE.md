# Database Backup & Restore

The business data for **both companies (MTC and TSK)** and all collections is captured
in a single MongoDB archive:

```
madina-database-dump.archive.gz
```

This was produced **read-only** with `mongodump` (no data was altered while creating it).

## What's inside
A complete `mongodump` of the application database (all collections: vehicles, parts,
tracked_parts, customers, invoices, payments, expenses, brokers, loans, container_invoices,
income_tt, users, roles, settings, audit_logs, etc.). MTC and TSK records are distinguished
internally by a `company_id` field on each document.

## Restore into a fresh MongoDB

> Requires the MongoDB Database Tools (`mongorestore`), which ship with MongoDB
> or install separately: https://www.mongodb.com/docs/database-tools/

Restore into a database named to match your backend `DB_NAME`:

```bash
# Restore the whole dump; --nsFrom/--nsTo remaps the original DB name to yours.
mongorestore \
  --uri="<YOUR_MONGO_URL>" \
  --gzip --archive=madina-database-dump.archive.gz \
  --nsFrom='test_database.*' --nsTo='<YOUR_DB_NAME>.*'
```

- Replace `<YOUR_MONGO_URL>` with your connection string (Atlas or local).
- Replace `<YOUR_DB_NAME>` with the value you set for `DB_NAME` in `backend/.env`.
- If you keep `DB_NAME=test_database`, you can omit the `--nsFrom/--nsTo` flags.

### Restore into an existing DB (overwrite matching docs)
Add `--drop` to replace existing collections before importing:
```bash
mongorestore --uri="<YOUR_MONGO_URL>" --drop --gzip \
  --archive=madina-database-dump.archive.gz \
  --nsFrom='test_database.*' --nsTo='<YOUR_DB_NAME>.*'
```

## Verify after restore
```bash
mongosh "<YOUR_MONGO_URL>" --eval 'db.getSiblingDB("<YOUR_DB_NAME>").customers.countDocuments()'
```
Then start the backend + frontend and confirm your records appear (switch between the
MTC and TSK companies in the header to verify both datasets).

## Human-readable JSON exports (optional)
The running app can also export per-company JSON/CSV from the UI (Settings/Reports)
and via the API export endpoints. Those are convenience exports; the `mongodump`
archive above is the authoritative, complete backup.
