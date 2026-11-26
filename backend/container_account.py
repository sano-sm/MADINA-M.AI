"""Independent Container & Received Amount sheets.
These collections deliberately do not read/write Container Invoice, TT, BL,
customers, dashboard, or any other financial ledger. Shared MTC/TSK overview.
"""
import math
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import Depends, HTTPException
from pydantic import BaseModel, field_validator
from pymongo import ReturnDocument


def mount_container_account_routes(api, database, require):
    sheets = database.container_account_sheets
    entries = database.container_account_entries
    meta = database.container_account_meta

    def utc_now():
        return datetime.now(timezone.utc).isoformat()

    class AccountRow(BaseModel):
        date: str = ""
        company: str = "MTC"
        destination: str = "UAE"
        container_no: str
        invoice_no: str = ""
        container_amount: float = 0
        received_amount: float = 0
        surrender_date: str = ""

        @field_validator("company")
        @classmethod
        def valid_company(cls, value):
            normalized = str(value).strip().upper()
            if normalized not in ("MTC", "TSK"):
                raise ValueError("Company must be MTC or TSK")
            return normalized

        @field_validator("destination")
        @classmethod
        def valid_destination(cls, value):
            normalized = str(value).strip().upper()
            if normalized not in ("UAE", "PAK", "PAKISTAN"):
                raise ValueError("Destination must be UAE or Pakistan")
            return "Pakistan" if normalized in ("PAK", "PAKISTAN") else "UAE"

        @field_validator("container_no")
        @classmethod
        def valid_container(cls, value):
            cleaned = str(value).strip().upper()
            if not cleaned or len(cleaned) > 80:
                raise ValueError("Enter a container number (maximum 80 characters)")
            return cleaned

        @field_validator("container_amount", "received_amount")
        @classmethod
        def valid_amount(cls, value):
            if not math.isfinite(value) or value < 0 or value > 1_000_000_000_000:
                raise ValueError("Amount must be finite and non-negative")
            return round(value, 2)

        @field_validator("date", "invoice_no", "surrender_date")
        @classmethod
        def valid_text(cls, value):
            return str(value or "").strip()[:100]

    async def ensure_first_sheet():
        await sheets.update_one(
            {"id": "container-account-sheet-01"},
            {"$setOnInsert": {"id": "container-account-sheet-01", "number": 1,
                              "name": "Sheet 01", "created_at": utc_now()}},
            upsert=True,
        )

    def summarize(rows):
        totals = {"MTC UAE": 0, "TSK UAE": 0, "PAK": 0}
        for row in rows:
            if not row.get("container_no"):
                continue
            destination = str(row.get("destination", "")).upper()
            company = str(row.get("company", "")).upper()
            if destination in ("PAK", "PAKISTAN"):
                totals["PAK"] += 1
            elif destination == "UAE" and company in ("MTC", "TSK"):
                totals[company + " UAE"] += 1
        container_total = round(sum(float(x.get("container_amount", 0) or 0) for x in rows), 2)
        received_total = round(sum(float(x.get("received_amount", 0) or 0) for x in rows), 2)
        difference = round(container_total - received_total, 2)
        return {
            "containers": totals,
            "container_count": sum(totals.values()),
            "container_total": container_total,
            "received_total": received_total,
            "balance_label": "Overpaid" if difference < 0 else "Balance Due",
            "balance_amount": abs(difference),
            "is_overpaid": difference < 0,
        }

    @api.get("/container-account")
    async def account_overview(user: dict = Depends(require("finance.view"))):
        await ensure_first_sheet()
        sheet_rows = await sheets.find({}, {"_id": 0}).sort("number", 1).to_list(1000)
        rows = await entries.find({}, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(50000)
        return {"sheets": sheet_rows, "rows": rows, "summary": summarize(rows)}

    @api.post("/container-account/sheets")
    async def create_account_sheet(user: dict = Depends(require("finance.edit"))):
        await ensure_first_sheet()
        if await sheets.count_documents({}) >= 1000:
            raise HTTPException(400, "Sheet limit reached")
        sequence = await meta.find_one_and_update(
            {"_id": "container-account-sheet-sequence"},
            {"$inc": {"value": 1}},
            upsert=True, return_document=ReturnDocument.AFTER,
        )
        number = int(sequence["value"]) + 1
        sheet = {"id": str(uuid4()), "number": number,
                 "name": "Sheet " + str(number).zfill(2), "created_at": utc_now()}
        await sheets.insert_one(sheet)
        sheet.pop("_id", None)
        return sheet

    @api.post("/container-account/sheets/{sheet_id}/rows")
    async def add_account_row(sheet_id: str, body: AccountRow,
                              user: dict = Depends(require("finance.edit"))):
        if not await sheets.find_one({"id": sheet_id}):
            raise HTTPException(404, "Sheet not found")
        entry = {**body.model_dump(), "id": str(uuid4()), "sheet_id": sheet_id,
                 "created_at": utc_now(), "updated_at": utc_now()}
        await entries.insert_one(entry)
        entry.pop("_id", None)
        return entry

    @api.put("/container-account/rows/{row_id}")
    async def update_account_row(row_id: str, body: AccountRow,
                                 user: dict = Depends(require("finance.edit"))):
        replacement = {**body.model_dump(), "updated_at": utc_now()}
        result = await entries.update_one({"id": row_id}, {"$set": replacement})
        if result.matched_count == 0:
            raise HTTPException(404, "Row not found")
        return {"ok": True}

    @api.delete("/container-account/rows/{row_id}")
    async def delete_account_row(row_id: str,
                                 user: dict = Depends(require("finance.edit"))):
        result = await entries.delete_one({"id": row_id})
        if result.deleted_count == 0:
            raise HTTPException(404, "Row not found")
        return {"ok": True}

    @api.delete("/container-account/sheets/{sheet_id}")
    async def delete_empty_account_sheet(sheet_id: str,
                                         user: dict = Depends(require("finance.edit"))):
        if sheet_id == "container-account-sheet-01":
            raise HTTPException(400, "The first sheet cannot be deleted")
        if await entries.count_documents({"sheet_id": sheet_id}):
            raise HTTPException(400, "Remove sheet entries before deleting this sheet")
        result = await sheets.delete_one({"id": sheet_id})
        if result.deleted_count == 0:
            raise HTTPException(404, "Sheet not found")
        return {"ok": True}
