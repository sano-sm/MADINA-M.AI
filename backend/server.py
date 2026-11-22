from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import csv
import uuid
import base64
import logging
import json
import zipfile
from urllib.parse import urlparse
from io import BytesIO
from datetime import date, datetime, timezone, timedelta
from typing import List, Optional

import random
import bcrypt
import jwt
import httpx
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph,
                                Spacer, Image as RLImage)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ---------------- Multi-company (tenant) scoping ----------------
from contextvars import ContextVar

VALID_COMPANIES = {"MTC", "TSK"}
DEFAULT_COMPANY = "MTC"
current_company: ContextVar[str] = ContextVar("current_company", default=DEFAULT_COMPANY)

# Collections whose documents belong to exactly one company and must be isolated.
PER_COMPANY_COLLECTIONS = {
    "vehicles", "parts", "tracked_parts", "part_sales", "customers",
    "invoices", "payments", "expenses", "employees", "salaries",
    "scrap_allocations", "shokubai_allocations", "small_sales", "audit_logs",
    "brokers", "broker_vehicles", "broker_payments", "loans", "loan_entries",
    "container_invoices", "income_tt", "bl_amounts",
    "monthly_summaries", "monthly_summary_years",
    "issued_documents", "fund_entries", "fiscal_years", "fiscal_snapshots", "customer_shipping", "vehicle_photos", "payment_revisions", "ai_agents",
}


class ScopedCollection:
    """Motor collection wrapper that auto-injects the active company_id into
    every query filter and every inserted document, so isolation can't be forgotten."""

    def __init__(self, coll):
        self._c = coll

    def _cid(self):
        return current_company.get()

    def _scope(self, flt):
        flt = dict(flt or {})
        flt["company_id"] = self._cid()
        return flt

    def find(self, flt=None, *a, **k):
        return self._c.find(self._scope(flt), *a, **k)

    async def find_one(self, flt=None, *a, **k):
        return await self._c.find_one(self._scope(flt), *a, **k)

    async def insert_one(self, doc, *a, **k):
        doc = dict(doc)
        doc.setdefault("company_id", self._cid())
        return await self._c.insert_one(doc, *a, **k)

    async def insert_many(self, docs, *a, **k):
        docs = [{**d, "company_id": d.get("company_id", self._cid())} for d in docs]
        return await self._c.insert_many(docs, *a, **k)

    async def update_one(self, flt, upd, *a, **k):
        return await self._c.update_one(self._scope(flt), upd, *a, **k)

    async def update_many(self, flt, upd, *a, **k):
        return await self._c.update_many(self._scope(flt), upd, *a, **k)

    async def delete_one(self, flt, *a, **k):
        return await self._c.delete_one(self._scope(flt), *a, **k)

    async def delete_many(self, flt, *a, **k):
        return await self._c.delete_many(self._scope(flt), *a, **k)

    async def count_documents(self, flt=None, *a, **k):
        return await self._c.count_documents(self._scope(flt), *a, **k)

    def aggregate(self, pipeline, *a, **k):
        pipeline = [{"$match": {"company_id": self._cid()}}] + list(pipeline)
        return self._c.aggregate(pipeline, *a, **k)


class ScopedDB:
    """db-like facade: per-company collections are wrapped/scoped; global ones pass through."""

    def __getattr__(self, name):
        coll = getattr(db, name)
        if name in PER_COMPANY_COLLECTIONS:
            return ScopedCollection(coll)
        return coll


sdb = ScopedDB()


def settings_id() -> str:
    return f"company:{current_company.get()}"

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
LOGO_PATH = ROOT_DIR / "assets" / "logo.png"

app = FastAPI()
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mtc")

GOLD = colors.HexColor("#D4AF37")
DARK = colors.HexColor("#111111")

# ---------------- Permissions ----------------
ALL_PERMISSIONS = [
    "dashboard.view",
    "vehicles.view", "vehicles.edit",
    "parts.view", "parts.edit",
    "customers.view", "customers.edit",
    "finance.view", "finance.edit",
    "reports.view",
    "settings.view", "settings.manage",
    "records.reverse",
]

DEFAULT_ROLES = {
    "Owner": ALL_PERMISSIONS,
    "Manager": ["dashboard.view", "vehicles.view", "vehicles.edit", "parts.view",
                "parts.edit", "customers.view", "customers.edit", "finance.view",
                "reports.view"],
    "Accountant": ["dashboard.view", "customers.view", "finance.view", "finance.edit",
                   "reports.view", "parts.view", "vehicles.view"],
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def purchase_company_or_default(value) -> str:
    """Per-record purchase ownership tag. Separate from tenant company_id.
    Legacy records with no tag are treated as MTC."""
    code = str(value or "MTC").strip().upper()
    return code if code in VALID_COMPANIES else "MTC"


def validate_purchase_company(value) -> str:
    code = str(value or "MTC").strip().upper()
    if code not in VALID_COMPANIES:
        raise HTTPException(status_code=400, detail="Purchase company must be MTC or TSK")
    return code


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, email: str, tv: int = 0) -> str:
    # Long-lived session: effectively "logged in until logout / password change".
    payload = {"sub": user_id, "email": email, "tv": tv,
               "exp": datetime.now(timezone.utc) + timedelta(days=365)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await sdb.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if payload.get("tv", 0) != user.get("token_version", 0):
        raise HTTPException(status_code=401, detail="Session expired")
    user.pop("password_hash", None)
    role = await sdb.roles.find_one({"name": user["role"]}, {"_id": 0})
    user["permissions"] = role["permissions"] if role else []
    return user


def require(permission: str):
    async def checker(user: dict = Depends(get_current_user)):
        if permission not in user.get("permissions", []):
            raise HTTPException(status_code=403, detail="Permission denied")
        return user
    return checker


async def audit(user: dict, action: str, entity: str, details: str = ""):
    await sdb.audit_logs.insert_one({
        "id": new_id(), "user_id": user["id"], "user_name": user["name"],
        "action": action, "entity": entity, "details": details, "timestamp": now_iso(),
    })


# ---------------- Models ----------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserIn(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None


class RoleIn(BaseModel):
    name: str
    permissions: List[str]


class CompanySettings(BaseModel):
    tax_id: str = Field(default="", pattern=r"^(T[0-9]{13})?$")
    name: str = "Madina Trading Co."
    short_name: str = "MTC"
    address: str = "781-1153, Kochi-ken, Tosa-shi, Tsukaji 1013-2, Japan"
    phone: str = "090-1570-0433"
    email: str = "MTC.jp09@gmail.com"
    logo_url: str = "/logo.png"
    tax_rate: float = 10.0
    invoice_prefix: str = "MTC-"
    currency: str = "JPY"
    currency_symbol: str = "¥"
    bank_details: str = ""
    invoice_footer: str = "Thank you for your business."


class AIAgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    endpoint_url: str = Field(min_length=1, max_length=2048)
    enabled: bool = True
    protocol: str = "generic_json"
    auth_env: str = ""
    capabilities: List[str] = []


class AIAgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    endpoint_url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    enabled: Optional[bool] = None
    protocol: Optional[str] = None
    auth_env: Optional[str] = None
    capabilities: Optional[List[str]] = None


class AIAgentMessageIn(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    context: dict = Field(default_factory=dict)


class MAICommandIn(BaseModel):
    command: str = Field(min_length=1, max_length=12000)
    context: dict = Field(default_factory=dict)


# ---- Brokers / Suppliers ----
class BrokerIn(BaseModel):
    bank_name: str = ""
    branch: str = ""
    branch_code: str = ""
    account_number: str = ""
    account_name: str = ""

    tax_id: str = Field(default="", pattern=r"^(T[0-9]{13})?$")
    name: str
    contact_person: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    notes: Optional[str] = ""


class BrokerVehicleIn(BaseModel):
    purchase_date: Optional[str] = None
    vehicle_name: str
    purchase_price: float = 0
    paid_amount: float = 0
    payment_method: Optional[str] = None  # cash | bank for any amount paid at entry
    chassis_number: Optional[str] = ""
    notes: Optional[str] = ""


class BrokerReceiveIn(BaseModel):
    vehicle_id: Optional[str] = None
    received_date: Optional[str] = None


class BrokerPaymentIn(BaseModel):
    date: Optional[str] = None
    amount: float = 0
    method: Optional[str] = "cash"  # cash | bank
    note: Optional[str] = ""


# ---- Loans / Udhaar ----
class LoanIn(BaseModel):
    name: str
    notes: Optional[str] = ""


class LoanEntryIn(BaseModel):
    date: Optional[str] = None
    entry_type: str  # borrowed | lent | repayment | received_back
    amount: float = 0
    method: Optional[str] = "cash"
    note: Optional[str] = ""


class Vehicle(BaseModel):
    chassis_number: str = Field(min_length=1)
    vehicle_name: Optional[str] = ""
    make: Optional[str] = ""
    model: Optional[str] = ""
    engine_name: Optional[str] = ""
    engine_code: Optional[str] = ""
    engine_number: Optional[str] = ""
    dismantle_date: Optional[str] = None
    year: Optional[int] = None
    color: Optional[str] = ""
    mileage: Optional[int] = None
    purchase_price: float = 0
    purchase_date: Optional[str] = None
    supplier: Optional[str] = ""
    notes: Optional[str] = ""
    broker_vehicle_id: Optional[str] = None  # link a pending broker vehicle on receipt
    payment_method: Optional[str] = None  # cash | bank when paid at purchase time
    # Per-record ownership tag only; does NOT change tenant/accounting scope.
    purchase_company: Optional[str] = None  # MTC | TSK


class Part(BaseModel):
    name: str
    part_number: Optional[str] = ""
    category: Optional[str] = ""
    quantity: int = 0
    unit_cost: float = 0
    sale_price: float = 0
    location: Optional[str] = ""
    purchase_date: Optional[str] = None
    supplier: Optional[str] = ""
    source_vehicle_id: Optional[str] = None
    source_chassis: Optional[str] = None
    payment_method: Optional[str] = None  # cash | bank when paid at purchase time
    # Per-record ownership tag only; does NOT change tenant/accounting scope.
    purchase_company: Optional[str] = None  # MTC | TSK


class Customer(BaseModel):
    tax_id: str = Field(default="", pattern=r"^(T[0-9]{13})?$")
    name: str
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""


class SecureCustomerDeleteIn(BaseModel):
    password: str


class InvoiceItem(BaseModel):
    description: str
    quantity: float = 1
    unit_price: float = 0
    item_type: Optional[str] = "part"  # part | vehicle | engine | half_cut | custom
    ref_id: Optional[str] = None


class InvoiceIn(BaseModel):
    customer_id: str
    items: List[InvoiceItem]
    tax_rate: Optional[float] = None
    notes: Optional[str] = ""
    amount_paid: float = 0
    sale_date: Optional[str] = None  # business date (YYYY-MM-DD); defaults to today
    payment_method: Optional[str] = None  # cash | bank for amount_paid at sale time


class PaymentIn(BaseModel):
    customer_id: str
    amount: float
    method: Optional[str] = "cash"
    date: Optional[str] = None
    is_advance: bool = False
    invoice_id: Optional[str] = None
    note: Optional[str] = ""


class PaymentCorrectionIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = Field(pattern="^(cash|bank)$")
    date: date
    note: Optional[str] = ""


class ExpenseIn(BaseModel):
    category: str
    amount: float
    date: Optional[str] = None
    description: Optional[str] = ""
    method: Optional[str] = "cash"
    # Shipping-only reference fields. Kept optional so existing expense records/API stay unchanged.
    company_name: Optional[str] = ""
    invoice_number: Optional[str] = ""
    payment_source: Optional[str] = ""


class CustomerShippingIn(BaseModel):
    customer_id: str
    container_number: str
    amount: float
    date: str
    method: str
    invoice_number: Optional[str] = ""
    note: Optional[str] = ""


class EmployeeIn(BaseModel):
    name: str
    position: Optional[str] = ""
    monthly_salary: float = 0
    phone: Optional[str] = ""


class SalaryIn(BaseModel):
    employee_id: str
    amount: float
    month: str
    note: Optional[str] = ""
    date: Optional[str] = None
    method: Optional[str] = "cash"


class DismantleItem(BaseModel):
    name: str
    part_number: Optional[str] = ""
    category: Optional[str] = ""
    quantity: int = 1
    unit_cost: float = 0
    sale_price: float = 0
    location: Optional[str] = ""


class DismantleIn(BaseModel):
    parts: List[DismantleItem] = []
    dismantle_date: Optional[str] = None
    create_engine: bool = True
    create_half_cut: bool = False
    engine_code: Optional[str] = ""
    engine_number: Optional[str] = ""
    # Optional fixed scrap value for this vehicle. Blank/None means normal monthly allocation.
    scrap_amount: Optional[float] = None
    # Required decision from UI: True = went with engine, False = retained.
    shokubai_with_engine: Optional[bool] = None


class CompleteSaleIn(BaseModel):
    sale_date: Optional[str] = None
    customer_id: str
    sale_price: float = 0
    amount_received: float = 0
    method: Optional[str] = None


class TrackedSellIn(BaseModel):
    sale_date: Optional[str] = None
    customer_id: str
    sale_price: float = 0
    amount_received: float = 0
    method: Optional[str] = None


class DismantleDateIn(BaseModel):
    dismantle_date: str


class ScrapIn(BaseModel):
    month: str  # YYYY-MM
    date: Optional[str] = None
    total_amount: float


class ShokubaiIn(BaseModel):
    sale_date: str  # YYYY-MM-DD cut-off
    total_amount: float


class SmallSaleIn(BaseModel):
    date: Optional[str] = None
    item_name: str
    sold_to: Optional[str] = ""
    amount: float = 0
    method: str = "cash"  # cash | bank
    note: Optional[str] = ""


class TrackedPurchaseIn(BaseModel):
    date: Optional[str] = None
    part_type: str  # engine | half_cut
    name: str
    supplier: Optional[str] = ""  # "From"
    purchase_price: float = 0
    payment_method: Optional[str] = None
    # Per-record ownership tag only; does NOT change tenant/accounting scope.
    purchase_company: Optional[str] = None  # MTC | TSK


class PartSaleIn(BaseModel):
    source_vehicle_id: str
    date: Optional[str] = None
    part_name: str
    customer_id: Optional[str] = None  # "To"
    sale_price: float = 0
    amount_received: float = 0
    category: Optional[str] = "parts"  # engine | half_cut | parts
    method: Optional[str] = None


class FundManualIn(BaseModel):
    date: Optional[str] = None
    direction: str  # in | out
    amount: float
    method: str  # cash | bank
    category: Optional[str] = "other"
    description: Optional[str] = ""


class FundTransferIn(BaseModel):
    date: Optional[str] = None
    amount: float
    from_method: str
    to_method: str
    note: Optional[str] = ""


# ---------------- Auth routes ----------------
@api.post("/auth/login")
async def login(body: LoginIn):
    user = await sdb.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account is disabled")
    token = create_token(user["id"], user["email"], user.get("token_version", 0))
    role = await sdb.roles.find_one({"name": user["role"]}, {"_id": 0})
    return {"token": token, "user": {
        "id": user["id"], "name": user["name"], "email": user["email"],
        "role": user["role"], "permissions": role["permissions"] if role else []}}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.post("/auth/refresh")
async def refresh_token(user: dict = Depends(get_current_user)):
    # Slide the session forward on each app open (keeps user logged in indefinitely).
    token = create_token(user["id"], user["email"], user.get("token_version", 0))
    return {"token": token}


# ---------------- App PIN (offline unlock) + email recovery ----------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"  # managed proxy constant


def _owner_email() -> str:
    return os.environ["ADMIN_EMAIL"].lower()


async def get_owner():
    return await db.users.find_one({"email": _owner_email()})


def _pin_ok(pin: str) -> bool:
    return isinstance(pin, str) and pin.isdigit() and 4 <= len(pin) <= 8


async def _owner_session(owner) -> dict:
    token = create_token(owner["id"], owner["email"], owner.get("token_version", 0))
    role = await db.roles.find_one({"name": owner["role"]}, {"_id": 0})
    return {"token": token, "user": {
        "id": owner["id"], "name": owner["name"], "email": owner["email"],
        "role": owner["role"], "permissions": role["permissions"] if role else []}}


async def send_email(to: str, subject: str, html: str):
    key = os.environ.get("EMERGENT_EMAIL_KEY")
    from_name = os.environ.get("EMAIL_FROM_NAME", "Madina Trading Co.")
    if not key:
        raise HTTPException(status_code=500, detail="Email not configured")
    payload = {"to": [to], "subject": subject, "html": html, "from_name": from_name}
    try:
        async with httpx.AsyncClient(timeout=30) as clientx:
            resp = await clientx.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                      headers={"X-Email-Key": key}, json=payload)
        resp.raise_for_status()
        return resp.json().get("id")
    except Exception as e:
        logger.error(f"Email send error: {e}")
        raise HTTPException(status_code=502, detail="Failed to send email")


class PinIn(BaseModel):
    pin: str


class PinForgotIn(BaseModel):
    email: EmailStr


class PinResetIn(BaseModel):
    email: EmailStr
    code: str
    pin: str


@api.get("/auth/pin/status")
async def pin_status():
    owner = await get_owner()
    return {"pin_set": bool(owner and owner.get("pin_hash"))}


@api.post("/auth/pin/verify")
async def pin_verify(body: PinIn):
    owner = await get_owner()
    if not owner or not owner.get("pin_hash"):
        raise HTTPException(status_code=400, detail="PIN not set")
    att = await db.pin_attempts.find_one({"id": "owner"}) or {}
    if att.get("locked_until") and att["locked_until"] > now_iso():
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes.")
    if not verify_password(body.pin, owner["pin_hash"]):
        fails = att.get("fails", 0) + 1
        upd = {"fails": fails}
        if fails >= 5:
            upd = {"fails": 0, "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}
        await db.pin_attempts.update_one({"id": "owner"}, {"$set": upd}, upsert=True)
        raise HTTPException(status_code=401, detail="Incorrect PIN")
    await db.pin_attempts.update_one({"id": "owner"}, {"$set": {"fails": 0, "locked_until": None}}, upsert=True)
    return await _owner_session(owner)


@api.post("/auth/pin/set")
async def pin_set(body: PinIn, user: dict = Depends(require("settings.manage"))):
    if not _pin_ok(body.pin):
        raise HTTPException(status_code=400, detail="PIN must be 4-8 digits")
    owner = await get_owner()
    if not owner:
        raise HTTPException(status_code=404, detail="Owner not found")
    await db.users.update_one({"id": owner["id"]}, {"$set": {"pin_hash": hash_password(body.pin)}})
    await audit(user, "update", "security", "Changed app PIN")
    return {"ok": True}


@api.post("/auth/pin/forgot")
async def pin_forgot(body: PinForgotIn):
    owner = await get_owner()
    if owner and body.email.lower() == owner["email"].lower():
        code = f"{random.randint(0, 999999):06d}"
        await db.pin_resets.update_one({"id": "owner"}, {"$set": {
            "code_hash": hash_password(code),
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
            "used": False}}, upsert=True)
        html = ("<div style='font-family:Arial,sans-serif;color:#111'>"
                "<h2 style='color:#111'>Madina Trading Co. — App PIN reset</h2>"
                "<p>Your PIN reset code is:</p>"
                f"<p style='font-size:30px;font-weight:bold;letter-spacing:6px'>{code}</p>"
                "<p>This code expires in 15 minutes. If you did not request this, please ignore this email.</p></div>")
        try:
            await send_email(owner["email"], "Your Madina Trading Co. app PIN reset code", html)
        except HTTPException:
            pass  # never reveal delivery status
    return {"ok": True}


@api.post("/auth/pin/reset")
async def pin_reset(body: PinResetIn):
    if not _pin_ok(body.pin):
        raise HTTPException(status_code=400, detail="PIN must be 4-8 digits")
    owner = await get_owner()
    if not owner or body.email.lower() != owner["email"].lower():
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    rec = await db.pin_resets.find_one({"id": "owner"})
    if (not rec or rec.get("used") or rec.get("expires_at", "") < now_iso()
            or not verify_password(body.code, rec.get("code_hash", ""))):
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    await db.users.update_one({"id": owner["id"]}, {"$set": {"pin_hash": hash_password(body.pin)}})
    await db.pin_resets.update_one({"id": "owner"}, {"$set": {"used": True}})
    await db.pin_attempts.update_one({"id": "owner"}, {"$set": {"fails": 0, "locked_until": None}}, upsert=True)
    return await _owner_session(owner)


# ---------------- Settings / Users / Roles ----------------
@api.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await sdb.settings.find_one({"id": settings_id()}, {"_id": 0})
    if not s:
        s = CompanySettings().model_dump()
        s["id"] = settings_id()
        s["company_id"] = current_company.get()
        s["short_name"] = current_company.get()
        await sdb.settings.insert_one(s)
    return s


@api.put("/settings")
async def update_settings(body: CompanySettings, user: dict = Depends(require("settings.manage"))):
    doc = body.model_dump()
    doc["id"] = settings_id()
    doc["company_id"] = current_company.get()
    await sdb.settings.update_one({"id": settings_id()}, {"$set": doc}, upsert=True)
    await audit(user, "update", "settings", "Company profile updated")
    return doc


def validate_ai_endpoint(url: str) -> str:
    parsed = urlparse((url or "").strip())
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=400, detail="AI Agent endpoint must be an HTTPS URL")
    if parsed.hostname.lower() in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        raise HTTPException(status_code=400, detail="Local AI Agent endpoints are not allowed")
    return url.strip()


def ai_agent_public(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "_id"}


@api.get("/ai-agents")
async def list_ai_agents(user: dict = Depends(require("settings.view"))):
    return await sdb.ai_agents.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)


@api.post("/ai-agents")
async def create_ai_agent(body: AIAgentIn, user: dict = Depends(require("settings.manage"))):
    endpoint = validate_ai_endpoint(body.endpoint_url)
    doc = {"id": new_id(), **body.model_dump(), "endpoint_url": endpoint, "created_at": now_iso(), "updated_at": now_iso(), "created_by": user["id"]}
    await sdb.ai_agents.insert_one(doc)
    await audit(user, "create", "ai_agent", f"AI Agent added: {body.name}")
    return ai_agent_public(doc)


@api.put("/ai-agents/{agent_id}")
async def update_ai_agent(agent_id: str, body: AIAgentUpdate, user: dict = Depends(require("settings.manage"))):
    existing = await sdb.ai_agents.find_one({"id": agent_id})
    if not existing:
        raise HTTPException(status_code=404, detail="AI Agent not found")
    updates = body.model_dump(exclude_unset=True)
    if "endpoint_url" in updates:
        updates["endpoint_url"] = validate_ai_endpoint(updates["endpoint_url"])
    updates["updated_at"] = now_iso()
    await sdb.ai_agents.update_one({"id": agent_id}, {"$set": updates})
    updated = await sdb.ai_agents.find_one({"id": agent_id}, {"_id": 0})
    await audit(user, "update", "ai_agent", f"AI Agent updated: {updated.get('name', agent_id)}")
    return updated


@api.delete("/ai-agents/{agent_id}")
async def delete_ai_agent(agent_id: str, user: dict = Depends(require("settings.manage"))):
    existing = await sdb.ai_agents.find_one({"id": agent_id})
    if not existing:
        raise HTTPException(status_code=404, detail="AI Agent not found")
    await sdb.ai_agents.delete_one({"id": agent_id})
    await audit(user, "delete", "ai_agent", f"AI Agent removed: {existing.get('name', agent_id)}")
    return {"ok": True}


@api.post("/ai-agents/{agent_id}/test")
async def test_ai_agent(agent_id: str, user: dict = Depends(require("settings.manage"))):
    agent = await sdb.ai_agents.find_one({"id": agent_id}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="AI Agent not found")
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=False) as client:
            response = await client.get(validate_ai_endpoint(agent["endpoint_url"]))
        return {"ok": response.is_success, "status": response.status_code, "agent_id": agent_id}
    except httpx.HTTPError as exc:
        return {"ok": False, "status": None, "error": str(exc), "agent_id": agent_id}


@api.post("/ai-agents/{agent_id}/message")
async def send_ai_agent_message(agent_id: str, body: AIAgentMessageIn, user: dict = Depends(require("settings.view"))):
    agent = await sdb.ai_agents.find_one({"id": agent_id}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="AI Agent not found")
    if not agent.get("enabled", False):
        raise HTTPException(status_code=409, detail="AI Agent is disabled")
    headers = {"Content-Type": "application/json"}
    env_name = (agent.get("auth_env") or "").strip()
    if env_name:
        if not env_name.replace("_", "").isalnum() or env_name not in os.environ:
            raise HTTPException(status_code=400, detail="AI Agent auth environment variable is not configured")
        headers["Authorization"] = f"Bearer {os.environ[env_name]}"
    payload = {"message": body.message, "context": body.context, "agent_id": agent_id, "company": current_company.get()}
    try:
        async with httpx.AsyncClient(timeout=45.0, follow_redirects=False) as client:
            response = await client.post(validate_ai_endpoint(agent["endpoint_url"]), json=payload, headers=headers)
        content_type = response.headers.get("content-type", "")
        result = response.json() if "json" in content_type else {"text": response.text}
        await audit(user, "message", "ai_agent", f"Message sent to AI Agent: {agent.get('name', agent_id)}")
        return {"ok": response.is_success, "status": response.status_code, "result": result}
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"AI Agent connection failed: {exc}")


@api.post("/mai/command")
async def mai_command(body: MAICommandIn, user: dict = Depends(get_current_user)):
    command = body.command.strip()
    lower = command.lower()
    if any(word in lower for word in ("summary", "خلاصہ", "summery")):
        return {"ok": True, "action": "navigate", "navigate_to": "/summary", "message": "Summary page تیار ہے۔"}
    if any(word in lower for word in ("new vehicle", "register vehicle", "نئی گاڑی", "گاڑی رجسٹر")):
        if "vehicles.edit" not in user.get("permissions", []):
            raise HTTPException(status_code=403, detail="Vehicle edit permission required")
        return {"ok": True, "action": "draft", "navigate_to": "/vehicles?voice=new", "requires_confirmation": True, "message": "Vehicle form کھول دیا جائے گا؛ save سے پہلے confirmation ضروری ہے۔"}
    if any(word in lower for word in ("invoice", "انوائس")):
        if "finance.edit" not in user.get("permissions", []):
            raise HTTPException(status_code=403, detail="Finance edit permission required")
        return {"ok": True, "action": "draft", "navigate_to": "/vehicle-sales?voice=draft", "requires_confirmation": True, "message": "Invoice draft تیار ہوگا؛ save سے پہلے confirmation ضروری ہے۔"}
    results = await record_search(command, user)
    return {"ok": True, "action": "search", "results": results[:100], "message": f"{len(results)} records ملے۔"}


@api.get("/users")
async def list_users(user: dict = Depends(require("settings.view"))):
    users = await sdb.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users


@api.post("/users")
async def create_user(body: UserIn, user: dict = Depends(require("settings.manage"))):
    if await sdb.users.find_one({"email": body.email.lower()}):
        raise HTTPException(status_code=400, detail="Email already exists")
    doc = {"id": new_id(), "name": body.name, "email": body.email.lower(),
           "password_hash": hash_password(body.password), "role": body.role,
           "active": True, "created_at": now_iso()}
    await sdb.users.insert_one(doc)
    await audit(user, "create", "user", f"Created user {body.email}")
    doc.pop("password_hash")
    doc.pop("_id", None)
    return doc


@api.put("/users/{uid}")
async def update_user(uid: str, body: UserUpdate, user: dict = Depends(require("settings.manage"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None and k != "password"}
    op = {"$set": update}
    if body.password:
        update["password_hash"] = hash_password(body.password)
        op["$inc"] = {"token_version": 1}  # invalidate existing sessions on password change
    await sdb.users.update_one({"id": uid}, op)
    await audit(user, "update", "user", f"Updated user {uid}")
    return {"ok": True}


@api.delete("/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require("settings.manage"))):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    await sdb.users.delete_one({"id": uid})
    await audit(user, "delete", "user", f"Deleted user {uid}")
    return {"ok": True}


@api.get("/roles")
async def list_roles(user: dict = Depends(get_current_user)):
    roles = await sdb.roles.find({}, {"_id": 0}).to_list(1000)
    return roles


@api.get("/permissions")
async def list_permissions(user: dict = Depends(get_current_user)):
    return ALL_PERMISSIONS


@api.post("/roles")
async def create_role(body: RoleIn, user: dict = Depends(require("settings.manage"))):
    if await sdb.roles.find_one({"name": body.name}):
        raise HTTPException(status_code=400, detail="Role already exists")
    doc = {"id": new_id(), "name": body.name, "permissions": body.permissions, "is_system": False}
    await sdb.roles.insert_one(doc)
    await audit(user, "create", "role", f"Created role {body.name}")
    doc.pop("_id", None)
    return doc


@api.put("/roles/{rid}")
async def update_role(rid: str, body: RoleIn, user: dict = Depends(require("settings.manage"))):
    await sdb.roles.update_one({"id": rid}, {"$set": {"name": body.name, "permissions": body.permissions}})
    await audit(user, "update", "role", f"Updated role {body.name}")
    return {"ok": True}


@api.delete("/roles/{rid}")
async def delete_role(rid: str, user: dict = Depends(require("settings.manage"))):
    role = await sdb.roles.find_one({"id": rid})
    if role and role.get("is_system"):
        raise HTTPException(status_code=400, detail="Cannot delete system role")
    await sdb.roles.delete_one({"id": rid})
    await audit(user, "delete", "role", f"Deleted role {rid}")
    return {"ok": True}


# ---------------- Cash & Bank / Funds helpers ----------------
def _valid_money_method(method: Optional[str]) -> bool:
    return method in ("cash", "bank")


async def fund_upsert(source_type: str, source_id: str, direction: str, amount: float,
                      method: Optional[str], date: Optional[str], category: str,
                      description: str = ""):
    """Idempotent cash/bank movement for one business record.
    Container & TT is intentionally never referenced here."""
    amount = round(float(amount or 0), 2)
    if amount <= 0 or not _valid_money_method(method):
        await sdb.fund_entries.delete_many({"source_type": source_type, "source_id": source_id})
        return
    doc = {
        "direction": direction, "amount": amount, "method": method,
        "date": date or now_iso()[:10], "category": category,
        "description": description or "", "updated_at": now_iso(),
    }
    old = await sdb.fund_entries.find_one({"source_type": source_type, "source_id": source_id}, {"_id": 0})
    if old:
        await sdb.fund_entries.update_one({"source_type": source_type, "source_id": source_id}, {"$set": doc})
    else:
        await sdb.fund_entries.insert_one({
            "id": new_id(), "source_type": source_type, "source_id": source_id,
            "created_at": now_iso(), **doc,
        })


async def fund_remove(source_type: str, source_id: str):
    await sdb.fund_entries.delete_many({"source_type": source_type, "source_id": source_id})


async def funds_summary() -> dict:
    entries = await sdb.fund_entries.find({"source_type": {"$ne": "loan_entry"}}, {"_id": 0}).to_list(50000)
    cash = 0.0
    bank = 0.0
    for e in entries:
        sign = 1 if e.get("direction") == "in" else -1
        if e.get("method") == "cash":
            cash += sign * float(e.get("amount") or 0)
        elif e.get("method") == "bank":
            bank += sign * float(e.get("amount") or 0)

    balances = await compute_balances_bulk()
    customer_receivable = round(sum(max(float(b.get("outstanding") or 0), 0) for b in balances.values()), 2)
    # A negative customer outstanding means the customer has sent more than billed;
    # treat that credit as money the business owes/carries for the customer.
    customer_credit = round(sum(max(-float(b.get("outstanding") or 0), 0) for b in balances.values()), 2)

    broker_payable = 0.0
    broker_receivable = 0.0
    for b in await sdb.brokers.find({}, {"_id": 0, "id": 1}).to_list(5000):
        ba = await broker_account(b["id"])
        broker_payable += float(ba.get("payment_due") or 0)
        broker_receivable += float(ba.get("advance") or 0)

    receivable = round(customer_receivable + broker_receivable, 2)
    payable = round(customer_credit + broker_payable, 2)
    cash = round(cash, 2)
    bank = round(bank, 2)
    available = round(cash + bank, 2)
    return {
        "cash": cash, "bank": bank, "available": available,
        "receivable": receivable, "payable": payable,
        "net_position": round(available + receivable - payable, 2),
        "customer_receivable": customer_receivable,
        "customer_credit": customer_credit,
        "customer_advance": customer_credit,
        "broker_receivable": round(broker_receivable, 2),
        "broker_advance": round(broker_receivable, 2),
        "broker_payable": round(broker_payable, 2),
        "loan_receivable": 0.0,
        "loan_payable": 0.0,
    }


# ---------------- Vehicles ----------------
@api.get("/vehicles")
async def list_vehicles(q: Optional[str] = None, status: Optional[str] = None,
                        user: dict = Depends(require("vehicles.view"))):
    query = {}
    if status:
        query["status"] = status
    if q:
        query["$or"] = [
            {"chassis_number": {"$regex": q, "$options": "i"}},
            {"vehicle_name": {"$regex": q, "$options": "i"}},
            {"make": {"$regex": q, "$options": "i"}},
            {"model": {"$regex": q, "$options": "i"}},
            {"supplier": {"$regex": q, "$options": "i"}},
            {"engine_name": {"$regex": q, "$options": "i"}},
            {"engine_code": {"$regex": q, "$options": "i"}},
            {"engine_number": {"$regex": q, "$options": "i"}},
        ]
    rows = await sdb.vehicles.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for r in rows:
        r["purchase_company"] = purchase_company_or_default(r.get("purchase_company"))
    return rows


@api.get("/vehicles/{vid}")
async def get_vehicle(vid: str, user: dict = Depends(require("vehicles.view"))):
    v = await sdb.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    v["purchase_company"] = purchase_company_or_default(v.get("purchase_company"))
    v["history"] = await sdb.audit_logs.find(
        {"entity": "vehicle", "details": {"$regex": v["chassis_number"]}}, {"_id": 0}
    ).sort("timestamp", -1).to_list(200)
    v["derived_parts"] = await sdb.parts.find({"source_vehicle_id": vid}, {"_id": 0}).to_list(500)
    v["tracked_parts"] = await sdb.tracked_parts.find({"source_vehicle_id": vid}, {"_id": 0}).to_list(200)
    # Recovery panel is exclusive to dismantled vehicles. Sold-complete vehicles get a sale summary.
    if v.get("status") == "dismantled":
        v["recovery"] = await compute_recovery(v)
        v["recovery"]["recovery_status"] = v.get("recovery_status", "open")
    elif v.get("status") == "sold_complete":
        cust = await sdb.customers.find_one({"id": v.get("customer_id")}, {"_id": 0, "name": 1}) if v.get("customer_id") else None
        pp = v.get("purchase_price", 0)
        sp = v.get("sale_price", 0)
        v["sale_summary"] = {
            "purchase_price": pp, "sale_price": sp,
            "sold_to": cust["name"] if cust else "",
            "sale_date": v.get("sale_date"),
            "amount_received": v.get("amount_received", 0),
            "balance_due": v.get("balance_due", 0),
            "profit_loss": round(sp - pp, 2),
        }
    return v


@api.post("/vehicles")
async def create_vehicle(body: Vehicle, user: dict = Depends(require("vehicles.edit"))):
    if await sdb.vehicles.find_one({"chassis_number": body.chassis_number}):
        raise HTTPException(status_code=400, detail="Chassis number already exists")
    doc = body.model_dump()
    doc["purchase_company"] = validate_purchase_company(doc.get("purchase_company"))
    broker_vehicle_id = doc.pop("broker_vehicle_id", None)
    # Keep the broker link on the vehicle so later edits never create a second
    # Cash/Bank purchase movement for a vehicle that was already accounted for
    # through the Broker page.
    if broker_vehicle_id:
        doc["broker_vehicle_id"] = broker_vehicle_id
        doc["payment_method"] = None
    vid = new_id()
    doc.update({"id": vid, "status": "in_stock", "sale_price": 0,
                "sale_date": None, "customer_id": None, "created_at": now_iso()})
    await sdb.vehicles.insert_one(doc)
    if broker_vehicle_id:
        await sdb.broker_vehicles.update_one({"id": broker_vehicle_id}, {"$set": {
            "status": "received", "received_date": now_iso()[:10], "vehicle_id": vid}})
    else:
        await fund_upsert("vehicle_purchase", vid, "out", body.purchase_price, body.payment_method,
                          body.purchase_date or now_iso()[:10], "vehicle_purchase",
                          f"Vehicle purchase {body.chassis_number}")
    await audit(user, "create", "vehicle",
                f"Purchased vehicle {body.chassis_number} ({body.make} {body.model}) for {body.purchase_price}")
    doc.pop("_id", None)
    return doc

@api.put("/vehicles/{vid}")
async def update_vehicle(vid: str, body: Vehicle, user: dict = Depends(require("vehicles.edit"))):
    existing = await sdb.vehicles.find_one({"id": vid}, {"_id": 0})
    updates = body.model_dump()
    # If an older frontend edits a record without sending purchase_company,
    # preserve its existing tag. Legacy untagged records remain MTC.
    if body.purchase_company is None:
        updates["purchase_company"] = purchase_company_or_default((existing or {}).get("purchase_company"))
    else:
        updates["purchase_company"] = validate_purchase_company(body.purchase_company)
    # Older broker-linked vehicles may not yet carry broker_vehicle_id on the
    # vehicle document, so also detect the existing Broker -> Vehicle link.
    broker_link = None
    if existing:
        broker_link = existing.get("broker_vehicle_id")
        if not broker_link:
            bv = await sdb.broker_vehicles.find_one({"vehicle_id": vid}, {"_id": 0, "id": 1})
            broker_link = bv.get("id") if bv else None
    if broker_link:
        updates["broker_vehicle_id"] = broker_link
        updates["payment_method"] = None
    await sdb.vehicles.update_one({"id": vid}, {"$set": updates})
    if existing and broker_link:
        # Broker payments are the single source of Cash/Bank movement.
        await fund_remove("vehicle_purchase", vid)
    elif existing:
        await fund_upsert("vehicle_purchase", vid, "out", body.purchase_price, body.payment_method,
                          body.purchase_date or existing.get("purchase_date") or now_iso()[:10],
                          "vehicle_purchase", f"Vehicle purchase {body.chassis_number}")
    await audit(user, "update", "vehicle", f"Updated vehicle {body.chassis_number}")
    return {"ok": True}

@api.delete("/vehicles/{vid}")
async def delete_vehicle(vid: str, user: dict = Depends(require("vehicles.edit"))):
    v = await sdb.vehicles.find_one({"id": vid})
    # Do not delete a vehicle record if its photos cannot be removed from storage.
    photos = await sdb.vehicle_photos.find({"vehicle_id": vid}, {"_id": 0}).to_list(100)
    if photos:
        try:
            await _remove_vehicle_photo_objects(photos)
        except Exception:
            raise HTTPException(status_code=502, detail="Could not delete vehicle photos from storage")
        await sdb.vehicle_photos.delete_many({"vehicle_id": vid})
    await sdb.vehicles.delete_one({"id": vid})
    await fund_remove("vehicle_purchase", vid)
    await fund_remove("vehicle_sale", vid)
    if v:
        await audit(user, "delete", "vehicle", f"Deleted vehicle {v['chassis_number']}")
    return {"ok": True}

@api.post("/vehicles/{vid}/dismantle")
async def dismantle_vehicle(vid: str, body: DismantleIn, user: dict = Depends(require("vehicles.edit"))):
    v = await sdb.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if v["status"] == "dismantled":
        raise HTTPException(status_code=400, detail="Vehicle already dismantled")
    if v["status"] != "in_stock":
        raise HTTPException(status_code=400, detail="Only in-stock vehicles can be dismantled")
    dismantle_date = body.dismantle_date or now_iso()[:10]
    if body.shokubai_with_engine is None:
        raise HTTPException(status_code=400, detail="Please select whether Shokubai went with the engine")
    if body.scrap_amount is not None and body.scrap_amount < 0:
        raise HTTPException(status_code=400, detail="Scrap amount cannot be negative")
    created = []
    source_purchase_company = purchase_company_or_default(v.get("purchase_company"))
    for p in body.parts:
        doc = p.model_dump()
        doc.update({"id": new_id(), "source_vehicle_id": vid,
                    "source_chassis": v["chassis_number"],
                    "purchase_company": source_purchase_company,
                    "created_at": now_iso()})
        await sdb.parts.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)
    # tracked engine / half cut
    tracked = []

    async def mk(part_type):
        doc = {"id": new_id(), "part_type": part_type, "source_vehicle_id": vid,
               "vehicle_name": f"{v.get('make','')} {v.get('model','')}".strip(),
               "chassis_number": v["chassis_number"],
               "engine_code": body.engine_code or v.get("engine_code", ""),
               "engine_number": body.engine_number or v.get("engine_number", ""),
               "purchase_company": source_purchase_company,
               "dismantle_date": dismantle_date, "status": "available",
               "sale_date": None, "customer_id": None, "sale_price": 0,
               "amount_received": 0, "balance_due": 0, "created_at": now_iso()}
        await sdb.tracked_parts.insert_one(doc)
        doc.pop("_id", None)
        tracked.append(doc)

    if body.create_engine:
        await mk("engine")
    if body.create_half_cut:
        await mk("half_cut")
    await sdb.vehicles.update_one({"id": vid}, {"$set": {"status": "dismantled",
                                 "dismantle_date": dismantle_date, "dismantled_date": now_iso(),
                                 "recovery_status": "open",
                                 "scrap_amount": body.scrap_amount,
                                 "shokubai_with_engine": body.shokubai_with_engine}})
    await audit(user, "dismantle", "vehicle",
                f"Dismantled vehicle {v['chassis_number']} on {dismantle_date} into {len(created)} part(s) + {len(tracked)} tracked; cost from purchase {v['purchase_price']}")
    return {"vehicle_id": vid, "parts_created": created, "tracked_created": tracked}


@api.post("/vehicles/{vid}/sell")
async def sell_complete(vid: str, body: CompleteSaleIn,
                        user: dict = Depends(require("vehicles.edit"))):
    v = await sdb.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if v["status"] == "dismantled":
        raise HTTPException(status_code=400, detail="Dismantled vehicle cannot be sold as complete")
    if v["status"] != "in_stock":
        raise HTTPException(status_code=400, detail="Only in-stock vehicles can be sold as complete")
    sale_date = body.sale_date or now_iso()[:10]
    balance = round(body.sale_price - body.amount_received, 2)
    await sdb.vehicles.update_one({"id": vid}, {"$set": {
        "status": "sold_complete", "sale_price": body.sale_price, "sale_date": sale_date,
        "customer_id": body.customer_id, "amount_received": body.amount_received,
        "balance_due": balance}})
    await fund_upsert("vehicle_sale", vid, "in", body.amount_received, body.method,
                      sale_date, "vehicle_sale", f"Vehicle sale {v.get('chassis_number','')}")
    await audit(user, "sell", "vehicle",
                f"Sold complete vehicle {v['chassis_number']} for {body.sale_price}, received {body.amount_received}")
    return {"ok": True, "balance_due": balance}

@api.put("/vehicles/{vid}/dismantle-date")
async def correct_dismantle_date(vid: str, body: DismantleDateIn,
                                 user: dict = Depends(require("records.reverse"))):
    v = await sdb.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    old = v.get("dismantle_date")
    await sdb.vehicles.update_one({"id": vid}, {"$set": {"dismantle_date": body.dismantle_date}})
    await sdb.tracked_parts.update_many({"source_vehicle_id": vid}, {"$set": {"dismantle_date": body.dismantle_date}})
    await audit(user, "correct", "vehicle",
                f"Corrected dismantle date for {v['chassis_number']} from {old} to {body.dismantle_date}")
    return {"ok": True, "old": old, "new": body.dismantle_date}



# ---------------- Vehicle photo gallery (object storage) ----------------
# Install boto3 and Pillow; configure S3_BUCKET, S3_ENDPOINT_URL (optional),
# S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY. No image bytes are stored in MongoDB.
async def _photo_bucket():
    bucket = os.environ.get("S3_BUCKET")
    if not bucket:
        raise HTTPException(status_code=503, detail="Photo storage is not configured (S3_BUCKET)")
    return bucket


def _photo_s3():
    import boto3
    opts = {}
    endpoint = os.environ.get("S3_ENDPOINT_URL") or os.environ.get("S3_ENDPOINT")
    if endpoint:
        opts["endpoint_url"] = endpoint
    if os.environ.get("S3_REGION"):
        opts["region_name"] = os.environ["S3_REGION"]
    access_key = os.environ.get("S3_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID")
    secret_key = os.environ.get("S3_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    if access_key:
        opts["aws_access_key_id"] = access_key
    if secret_key:
        opts["aws_secret_access_key"] = secret_key
    return boto3.client("s3", **opts)


@api.get("/vehicles/{vid}/photos")
async def list_vehicle_photos(vid: str, user: dict = Depends(require("vehicles.view"))):
    if not await sdb.vehicles.find_one({"id": vid}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return await sdb.vehicle_photos.find({"vehicle_id": vid}, {"_id": 0, "object_key": 0, "thumb_key": 0}).sort("created_at", 1).to_list(100)


@api.post("/vehicles/{vid}/photos")
async def upload_vehicle_photo(vid: str, request: Request, user: dict = Depends(require("vehicles.edit"))):
    import asyncio
    from PIL import Image, ImageOps, UnidentifiedImageError
    if not await sdb.vehicles.find_one({"id": vid}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if await sdb.vehicle_photos.count_documents({"vehicle_id": vid}) >= 20:
        raise HTTPException(status_code=400, detail="Maximum 20 photos per vehicle")
    kind = request.headers.get("X-Photo-Type", "vehicle")
    if kind not in ("vehicle", "chassis", "additional"):
        raise HTTPException(status_code=400, detail="Invalid photo type")
    if request.headers.get("content-type", "").split(";")[0] not in ("image/jpeg", "image/webp", "image/png"):
        raise HTTPException(status_code=415, detail="JPEG, WebP or PNG required")
    if int(request.headers.get("content-length") or 0) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds 8 MB")
    data = await request.body()
    if not data or len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be 1 byte to 8 MB")
    try:
        def make_images():
            with Image.open(BytesIO(data)) as source:
                source.verify()
            with Image.open(BytesIO(data)) as source:
                img = ImageOps.exif_transpose(source).convert("RGB")
                if img.width * img.height > 45_000_000:
                    raise ValueError("Image dimensions too large")
                img.thumbnail((3000, 3000))
                main = BytesIO(); img.save(main, format="JPEG", quality=90, optimize=True)
                img.thumbnail((360, 360))
                thumb = BytesIO(); img.save(thumb, format="JPEG", quality=75, optimize=True)
                return main.getvalue(), thumb.getvalue()
        main_bytes, thumb_bytes = await asyncio.to_thread(make_images)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid image") from exc
    bucket = await _photo_bucket()
    pid = new_id()
    base = f"vehicle-photos/{current_company.get()}/{vid}/{pid}"
    key, thumb_key = base + ".jpg", base + "-thumb.jpg"
    s3 = _photo_s3()
    try:
        await asyncio.to_thread(s3.put_object, Bucket=bucket, Key=key, Body=main_bytes, ContentType="image/jpeg")
        await asyncio.to_thread(s3.put_object, Bucket=bucket, Key=thumb_key, Body=thumb_bytes, ContentType="image/jpeg")
        doc = {"id": pid, "vehicle_id": vid, "kind": kind, "object_key": key,
               "thumb_key": thumb_key, "created_at": now_iso()}
        await sdb.vehicle_photos.insert_one(doc)
    except Exception:
        for k in (key, thumb_key):
            try:
                await asyncio.to_thread(s3.delete_object, Bucket=bucket, Key=k)
            except Exception:
                logger.warning("Failed to clean up orphaned photo object")
        raise HTTPException(status_code=502, detail="Photo storage upload failed")
    await audit(user, "create", "vehicle_photo", f"Photo added to vehicle {vid}")
    return {"id": pid, "vehicle_id": vid, "kind": kind, "created_at": doc["created_at"]}


@api.get("/vehicles/{vid}/photos/{pid}/image")
async def get_vehicle_photo_image(vid: str, pid: str, thumb: bool = False,
                                  user: dict = Depends(require("vehicles.view"))):
    import asyncio
    photo = await sdb.vehicle_photos.find_one({"vehicle_id": vid, "id": pid}, {"_id": 0})
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    key = photo["thumb_key"] if thumb else photo["object_key"]
    try:
        obj = await asyncio.to_thread(_photo_s3().get_object, Bucket=await _photo_bucket(), Key=key)
        data = await asyncio.to_thread(obj["Body"].read)
    except Exception:
        raise HTTPException(status_code=502, detail="Unable to load photo")
    return StreamingResponse(BytesIO(data), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


async def _remove_vehicle_photo_objects(photos):
    import asyncio
    if not photos:
        return
    s3, bucket = _photo_s3(), await _photo_bucket()
    for p in photos:
        for key in (p["object_key"], p["thumb_key"]):
            await asyncio.to_thread(s3.delete_object, Bucket=bucket, Key=key)


@api.delete("/vehicles/{vid}/photos/{pid}")
async def delete_vehicle_photo(vid: str, pid: str, user: dict = Depends(require("vehicles.edit"))):
    photo = await sdb.vehicle_photos.find_one({"vehicle_id": vid, "id": pid}, {"_id": 0})
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        await _remove_vehicle_photo_objects([photo])
    except Exception:
        raise HTTPException(status_code=502, detail="Photo deletion from storage failed")
    await sdb.vehicle_photos.delete_one({"vehicle_id": vid, "id": pid})
    await audit(user, "delete", "vehicle_photo", f"Photo deleted from vehicle {vid}")
    return {"ok": True}


# ---------------- Parts ----------------
@api.get("/parts")
async def list_parts(q: Optional[str] = None, user: dict = Depends(require("parts.view"))):
    query = {}
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"part_number": {"$regex": q, "$options": "i"}},
            {"supplier": {"$regex": q, "$options": "i"}},
            {"category": {"$regex": q, "$options": "i"}},
            {"location": {"$regex": q, "$options": "i"}},
            {"source_chassis": {"$regex": q, "$options": "i"}},
        ]
    rows = await sdb.parts.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    for r in rows:
        r["purchase_company"] = purchase_company_or_default(r.get("purchase_company"))
    return rows


@api.post("/parts")
async def create_part(body: Part, user: dict = Depends(require("parts.edit"))):
    doc = body.model_dump()
    doc["purchase_company"] = validate_purchase_company(doc.get("purchase_company"))
    doc.update({"id": new_id(), "created_at": now_iso(), "purchased_quantity": body.quantity})
    await sdb.parts.insert_one(doc)
    if not body.source_vehicle_id:
        await fund_upsert("part_purchase", doc["id"], "out", body.unit_cost * body.quantity,
                          body.payment_method, body.purchase_date or now_iso()[:10],
                          "parts_purchase", f"Parts purchase {body.name}")
    await audit(user, "create", "part", f"Added part {body.name} qty {body.quantity}")
    doc.pop("_id", None)
    return doc


@api.put("/parts/{pid}")
async def update_part(pid: str, body: Part, user: dict = Depends(require("parts.edit"))):
    existing = await sdb.parts.find_one({"id": pid}, {"_id": 0})
    updates = body.model_dump()
    if body.purchase_company is None:
        updates["purchase_company"] = purchase_company_or_default((existing or {}).get("purchase_company"))
    else:
        updates["purchase_company"] = validate_purchase_company(body.purchase_company)
    await sdb.parts.update_one({"id": pid}, {"$set": updates})
    if not body.source_vehicle_id:
        await fund_upsert("part_purchase", pid, "out", body.unit_cost * body.quantity,
                          body.payment_method, body.purchase_date or now_iso()[:10],
                          "parts_purchase", f"Parts purchase {body.name}")
    await audit(user, "update", "part", f"Updated part {body.name}")
    return {"ok": True}


@api.delete("/parts/{pid}")
async def delete_part(pid: str, user: dict = Depends(require("parts.edit"))):
    await sdb.parts.delete_one({"id": pid})
    await fund_remove("part_purchase", pid)
    await audit(user, "delete", "part", f"Deleted part {pid}")
    return {"ok": True}


# ---------------- Customers ----------------
async def customer_balance(cid: str) -> dict:
    invoices = await sdb.invoices.find({"customer_id": cid}, {"_id": 0}).to_list(2000)
    payments = await sdb.payments.find({"customer_id": cid}, {"_id": 0}).to_list(2000)
    billed = sum(i["total"] for i in invoices)
    paid_on_invoices = sum(i.get("amount_paid", 0) for i in invoices)
    # Linked invoice payments are already included in invoice.amount_paid.
    # Count only unlinked payments here so a receipt is never counted twice.
    standalone = sum(p["amount"] for p in payments if not p.get("invoice_id"))
    advances = sum(p["amount"] for p in payments if p.get("is_advance") and not p.get("invoice_id"))
    # engine / half cut sales
    for tp in await sdb.tracked_parts.find({"customer_id": cid, "status": "sold", "invoice_id": {"$in": [None, ""]}}, {"_id": 0}).to_list(2000):
        billed += tp.get("sale_price", 0)
        paid_on_invoices += tp.get("amount_received", 0)
    # complete vehicle sales
    for cv in await sdb.vehicles.find({"customer_id": cid, "status": "sold_complete", "invoice_id": {"$in": [None, ""]}}, {"_id": 0}).to_list(2000):
        billed += cv.get("sale_price", 0)
        paid_on_invoices += cv.get("amount_received", 0)
    # vehicle-linked parts sales
    for ps in await sdb.part_sales.find({"customer_id": cid}, {"_id": 0}).to_list(2000):
        billed += ps.get("sale_price", 0)
        paid_on_invoices += ps.get("amount_received", 0)
    billed += sum(float(x.get("amount") or 0) for x in await sdb.customer_shipping.find({"customer_id": cid}, {"_id": 0, "amount": 1}).to_list(5000))
    total_paid = paid_on_invoices + standalone
    return {"billed": round(billed, 2), "paid": round(total_paid, 2), "advance": advances,
            "outstanding": round(billed - total_paid, 2)}


async def compute_balances_bulk() -> dict:
    invoices = await sdb.invoices.find({}, {"_id": 0, "customer_id": 1, "total": 1, "amount_paid": 1}).to_list(20000)
    payments = await sdb.payments.find({}, {"_id": 0, "customer_id": 1, "amount": 1, "is_advance": 1, "invoice_id": 1}).to_list(20000)
    result = {}
    for i in invoices:
        b = result.setdefault(i["customer_id"], {"billed": 0, "paid": 0, "advance": 0})
        b["billed"] += i["total"]
        b["paid"] += i.get("amount_paid", 0)
    for p in payments:
        b = result.setdefault(p["customer_id"], {"billed": 0, "paid": 0, "advance": 0})
        if not p.get("invoice_id"):
            b["paid"] += p["amount"]
            if p.get("is_advance"):
                b["advance"] += p["amount"]
    # tracked part (engine/half cut) sales
    for tp in await sdb.tracked_parts.find({"status": "sold", "invoice_id": {"$in": [None, ""]}}, {"_id": 0, "customer_id": 1, "sale_price": 1, "amount_received": 1}).to_list(20000):
        if tp.get("customer_id"):
            b = result.setdefault(tp["customer_id"], {"billed": 0, "paid": 0, "advance": 0})
            b["billed"] += tp.get("sale_price", 0)
            b["paid"] += tp.get("amount_received", 0)
    # complete vehicle sales
    for cv in await sdb.vehicles.find({"status": "sold_complete", "invoice_id": {"$in": [None, ""]}}, {"_id": 0, "customer_id": 1, "sale_price": 1, "amount_received": 1}).to_list(20000):
        if cv.get("customer_id"):
            b = result.setdefault(cv["customer_id"], {"billed": 0, "paid": 0, "advance": 0})
            b["billed"] += cv.get("sale_price", 0)
            b["paid"] += cv.get("amount_received", 0)
    # vehicle-linked parts sales
    for ps in await sdb.part_sales.find({}, {"_id": 0, "customer_id": 1, "sale_price": 1, "amount_received": 1}).to_list(20000):
        if ps.get("customer_id"):
            b = result.setdefault(ps["customer_id"], {"billed": 0, "paid": 0, "advance": 0})
            b["billed"] += ps.get("sale_price", 0)
            b["paid"] += ps.get("amount_received", 0)
    for sh in await sdb.customer_shipping.find({}, {"_id": 0, "customer_id": 1, "amount": 1}).to_list(20000):
        b = result.setdefault(sh["customer_id"], {"billed": 0, "paid": 0, "advance": 0})
        b["billed"] += float(sh.get("amount") or 0)
    for b in result.values():
        b["outstanding"] = round(b["billed"] - b["paid"], 2)
    return result


@api.get("/customers")
async def list_customers(user: dict = Depends(require("customers.view"))):
    customers = await sdb.customers.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    balances = await compute_balances_bulk()
    for c in customers:
        c["balance"] = balances.get(c["id"], {"billed": 0, "paid": 0, "advance": 0, "outstanding": 0})
    return customers


@api.get("/customers/{cid}")
async def get_customer(cid: str, user: dict = Depends(require("customers.view"))):
    c = await sdb.customers.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    c["balance"] = await customer_balance(cid)
    invs = await sdb.invoices.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Enrich each invoice line with the item name + chassis/engine from existing records
    # (read-only; no data is created or modified).
    for inv in invs:
        inv["balance"] = round(inv.get("total", 0) - inv.get("amount_paid", 0), 2)
        for it in inv.get("items", []):
            it["item_name"] = it.get("description") or ""
            it["chassis_number"] = ""
            it["engine_number"] = ""
            rid = it.get("ref_id")
            if not rid:
                continue
            if it.get("item_type") == "vehicle":
                v = await sdb.vehicles.find_one({"id": rid}, {"_id": 0, "chassis_number": 1, "engine_number": 1, "vehicle_name": 1, "make": 1, "model": 1})
                if v:
                    it["chassis_number"] = v.get("chassis_number", "") or ""
                    it["engine_number"] = v.get("engine_number", "") or ""
                    # Always prefer the real vehicle name here. Older invoice descriptions
                    # sometimes contained only the chassis number, which made Sales History
                    # show the chassis twice and hide the vehicle name.
                    it["item_name"] = (v.get("vehicle_name") or
                                       f"{v.get('make', '')} {v.get('model', '')}".strip() or
                                       it["item_name"])
            elif it.get("item_type") == "part":
                p = await sdb.parts.find_one({"id": rid}, {"_id": 0, "name": 1, "source_chassis": 1})
                if p:
                    it["chassis_number"] = p.get("source_chassis", "") or ""
                    if not it["item_name"]:
                        it["item_name"] = p.get("name", "")
            elif it.get("item_type") in ("engine", "half_cut"):
                tp = await sdb.tracked_parts.find_one({"id": rid}, {"_id": 0, "name": 1, "vehicle_name": 1,
                    "chassis_number": 1, "engine_number": 1, "engine_code": 1, "part_type": 1})
                if tp:
                    it["item_name"] = (tp.get("name") or tp.get("engine_code") or tp.get("vehicle_name") or
                                       ("Half Cut" if tp.get("part_type") == "half_cut" else "Engine"))
                    it["chassis_number"] = tp.get("chassis_number", "") or ""
                    it["engine_number"] = tp.get("engine_number", "") or ""
    c["invoices"] = invs
    # Engine / half-cut sales are stored on tracked_parts (not invoices) — include them.
    tracked = await sdb.tracked_parts.find({"customer_id": cid, "invoice_id": {"$in": [None, ""]}}, {"_id": 0}).sort("sale_date", -1).to_list(500)
    c["tracked_sales"] = [t for t in tracked if t.get("sale_price")]
    # Vehicle-linked parts sales are separate from invoices/tracked_parts; expose full detail for Sales History.
    c["part_sales"] = await sdb.part_sales.find({"customer_id": cid}, {"_id": 0}).sort("date", -1).to_list(1000)
    c["shipping_costs"] = await sdb.customer_shipping.find({"customer_id": cid}, {"_id": 0}).sort("date", -1).to_list(1000)
    c["payments"] = await sdb.payments.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Delivery/collection status is intentionally separate from payment/accounting.
    # A tick means the sold item physically left our possession; it does NOT mean paid.
    c["delivery_statuses"] = await sdb.customer_delivery_status.find(
        {"customer_id": cid, "company_id": {"$in":[None,current_company.get()]}}, {"_id": 0}
    ).to_list(5000)
    return c


class CustomerDeliveryStatusIn(BaseModel):
    sale_type: str
    sale_id: str
    delivered: bool = True


@api.put("/customers/{cid}/delivery-status")
async def set_customer_delivery_status(
    cid: str,
    body: CustomerDeliveryStatusIn,
    user: dict = Depends(require("customers.edit")),
):
    if body.sale_type not in ("invoice", "tracked_sale", "part_sale"):
        raise HTTPException(status_code=400, detail="Invalid sale type")
    if not body.sale_id:
        raise HTTPException(status_code=400, detail="Sale id is required")

    customer = await sdb.customers.find_one({"id": cid}, {"_id": 0, "id": 1})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Verify that the referenced sale really belongs to this customer.
    if body.sale_type == "invoice":
        sale = await sdb.invoices.find_one({"id": body.sale_id, "customer_id": cid}, {"_id": 0, "id": 1})
    elif body.sale_type == "tracked_sale":
        sale = await sdb.tracked_parts.find_one({"id": body.sale_id, "customer_id": cid}, {"_id": 0, "id": 1})
    else:
        sale = await sdb.part_sales.find_one({"id": body.sale_id, "customer_id": cid}, {"_id": 0, "id": 1})
    if not sale:
        raise HTTPException(status_code=404, detail="Customer sale not found")

    key = {"customer_id": cid, "sale_type": body.sale_type, "sale_id": body.sale_id}
    scoped_key = {**key,"company_id":{"$in":[None,current_company.get()]}}
    if body.delivered:
        await sdb.customer_delivery_status.update_one(
            scoped_key,
            {"$set": {**key, "company_id":current_company.get(), "delivered": True, "updated_at": now_iso(), "updated_by": user.get("id")}},
            upsert=True,
        )
    else:
        await sdb.customer_delivery_status.delete_one(scoped_key)

    await audit(
        user, "update", "customer_delivery",
        f"{'Delivered' if body.delivered else 'Delivery cleared'}: {body.sale_type} {body.sale_id}"
    )
    return {"ok": True, "delivered": body.delivered}


@api.post("/customers")
async def create_customer(body: Customer, user: dict = Depends(require("customers.edit"))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await sdb.customers.insert_one(doc)
    await audit(user, "create", "customer", f"Added customer {body.name}")
    doc.pop("_id", None)
    return doc


@api.put("/customers/{cid}")
async def update_customer(cid: str, body: Customer, user: dict = Depends(require("customers.edit"))):
    await sdb.customers.update_one({"id": cid}, {"$set": body.model_dump(exclude_unset=True)})
    await audit(user, "update", "customer", f"Updated customer {body.name}")
    return {"ok": True}


@api.post("/customers/{cid}/delete-secure")
async def delete_customer_secure(cid: str, body: SecureCustomerDeleteIn,
                                 user: dict = Depends(require("customers.edit"))):
    """Permanently delete only an empty customer after password re-verification.

    Customers that already have business history are deliberately protected from
    hard deletion so invoices, payments and inventory history can never be orphaned.
    """
    customer = await sdb.customers.find_one({"id": cid}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    raw_user = await db["users"].find_one({"id": user["id"]})
    if not raw_user or not verify_password(body.password, raw_user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect website password")

    links = {
        "invoices": await sdb.invoices.count_documents({"customer_id": cid}),
        "payments": await sdb.payments.count_documents({"customer_id": cid}),
        "vehicles": await sdb.vehicles.count_documents({"customer_id": cid}),
        "engine_halfcut": await sdb.tracked_parts.count_documents({"customer_id": cid}),
        "part_sales": await sdb.part_sales.count_documents({"customer_id": cid}),
        "customer_shipping": await sdb.customer_shipping.count_documents({"customer_id": cid}),
    }
    if any(links.values()):
        used = ", ".join(f"{k}: {v}" for k, v in links.items() if v)
        raise HTTPException(status_code=409, detail=f"This customer has linked history and cannot be permanently deleted ({used}).")

    await sdb.customers.delete_one({"id": cid})
    await audit(user, "delete", "customer", f"Securely deleted empty customer {customer.get('name', cid)}")
    return {"ok": True}


# ---------------- Container & TT (isolated module) ----------------
# This module links ONLY container_invoices <-> income_tt (via invoice_number).
# It never touches vehicles, parts, sales, customers, brokers or any other totals.
class ContainerItem(BaseModel):
    no: int
    name: Optional[str] = ""
    price: Optional[float] = 0


class ContainerInvoiceIn(BaseModel):
    company_name: Optional[str] = ""
    loading_date: Optional[str] = ""
    container_no: Optional[str] = ""
    invoice_number: Optional[str] = ""
    final_destination: Optional[str] = ""
    bl_surrender_date: Optional[str] = ""
    page_count: int = 1
    items: List[ContainerItem] = []


class IncomeTTIn(BaseModel):
    date: Optional[str] = ""
    invoice_number: Optional[str] = ""
    income_tt_amount: float = 0
    note: Optional[str] = ""


class BLAmountIn(BaseModel):
    date: Optional[str] = ""
    company_name: Optional[str] = ""
    final_destination: Optional[str] = ""
    container_no: Optional[str] = ""
    invoice_number: Optional[str] = ""
    bl_amount: float = 0
    paid_amount: float = 0
    paid_date: Optional[str] = ""
    surrender_date: Optional[str] = ""


class MonthlySummaryIn(BaseModel):
    opening_stock: float = 0
    buying: float = 0
    export_sales: float = 0
    local_sales: float = 0
    tt_received: float = 0
    shipping_cost: float = 0
    salary: float = 0
    rent_expenses: float = 0
    closing_stock: float = 0


def _ci_total(doc):
    if not doc:
        return 0
    return round(sum(float(it.get("price") or 0) for it in (doc.get("items") or [])), 2)


def _tt_status(cnr, cumulative):
    due = round(max(0.0, cnr - cumulative), 2)
    over = round(max(0.0, cumulative - cnr), 2)
    if cumulative <= 0:
        status = "unpaid"
    elif over > 0:
        status = "overpaid"
    elif due > 0:
        status = "partial"
    else:
        status = "paid"
    return due, over, status


@api.get("/container-invoices")
async def list_container_invoices(user: dict = Depends(require("finance.view"))):
    rows = await sdb.container_invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for r in rows:
        r["total"] = _ci_total(r)
        r["item_count"] = len([it for it in (r.get("items") or []) if (it.get("name") or it.get("price"))])
    return rows


@api.post("/container-invoices")
async def create_container_invoice(body: ContainerInvoiceIn, user: dict = Depends(require("finance.edit"))):
    doc = body.model_dump()
    doc["items"] = [it for it in doc["items"] if (it.get("name") or it.get("price"))]
    doc.update({"id": new_id(), "created_at": now_iso()})
    await sdb.container_invoices.insert_one(doc)
    await audit(user, "create", "container_invoice", f"Created container invoice {body.invoice_number or '(no number)'}")
    doc.pop("_id", None)
    doc["total"] = _ci_total(doc)
    return doc


@api.get("/container-invoices/{cid}")
async def get_container_invoice(cid: str, user: dict = Depends(require("finance.view"))):
    doc = await sdb.container_invoices.find_one({"id": cid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Container invoice not found")
    doc["total"] = _ci_total(doc)
    return doc


@api.put("/container-invoices/{cid}")
async def update_container_invoice(cid: str, body: ContainerInvoiceIn, user: dict = Depends(require("finance.edit"))):
    existing = await sdb.container_invoices.find_one({"id": cid})
    if not existing:
        raise HTTPException(status_code=404, detail="Container invoice not found")
    doc = body.model_dump()
    doc["items"] = [it for it in doc["items"] if (it.get("name") or it.get("price"))]
    await sdb.container_invoices.update_one({"id": cid}, {"$set": doc})
    await audit(user, "update", "container_invoice", f"Updated container invoice {body.invoice_number or cid}")
    return {"ok": True}


@api.delete("/container-invoices/{cid}")
async def delete_container_invoice(cid: str, user: dict = Depends(require("finance.edit"))):
    await sdb.container_invoices.delete_one({"id": cid})
    await audit(user, "delete", "container_invoice", f"Deleted container invoice {cid}")
    return {"ok": True}


@api.get("/income-tt")
async def list_income_tt(user: dict = Depends(require("finance.view"))):
    rows = await sdb.income_tt.find({}, {"_id": 0}).sort("date", -1).to_list(5000)
    invs = await sdb.container_invoices.find({}, {"_id": 0}).to_list(2000)
    inv_map = {i.get("invoice_number"): i for i in invs if i.get("invoice_number")}
    cum = {}
    for r in rows:
        k = r.get("invoice_number")
        cum[k] = cum.get(k, 0) + float(r.get("income_tt_amount") or 0)
    out = []
    for r in rows:
        inv = inv_map.get(r.get("invoice_number"))
        cnr = _ci_total(inv) if inv else 0
        cumulative = round(cum.get(r.get("invoice_number"), 0), 2)
        due, over, status = _tt_status(cnr, cumulative)
        r["from"] = inv.get("company_name", "") if inv else ""
        r["container_no"] = inv.get("container_no", "") if inv else ""
        r["final_destination"] = inv.get("final_destination", "") if inv else ""
        r["cnr_amount"] = cnr
        r["cumulative_tt"] = cumulative
        r["due"] = due
        r["over"] = over
        r["status"] = status
        out.append(r)
    return out


@api.post("/income-tt")
async def create_income_tt(body: IncomeTTIn, user: dict = Depends(require("finance.edit"))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await sdb.income_tt.insert_one(doc)
    await audit(user, "create", "income_tt", f"Income TT {body.income_tt_amount} for {body.invoice_number}")
    doc.pop("_id", None)
    return doc


@api.put("/income-tt/{tid}")
async def update_income_tt(tid: str, body: IncomeTTIn, user: dict = Depends(require("finance.edit"))):
    r = await sdb.income_tt.find_one({"id": tid})
    if not r:
        raise HTTPException(status_code=404, detail="TT entry not found")
    await sdb.income_tt.update_one({"id": tid}, {"$set": body.model_dump()})
    await audit(user, "update", "income_tt", f"Updated income TT {tid}")
    return {"ok": True}


@api.delete("/income-tt/{tid}")
async def delete_income_tt(tid: str, user: dict = Depends(require("finance.edit"))):
    await sdb.income_tt.delete_one({"id": tid})
    await audit(user, "delete", "income_tt", f"Deleted income TT {tid}")
    return {"ok": True}


# ---------------- BL Amount (fully isolated) ----------------
# This page has its own collection and totals. It deliberately does NOT read from or
# write to container invoices, Income TT, customers, sales, vehicles, or any other module.
@api.get("/bl-amounts")
async def list_bl_amounts(user: dict = Depends(require("finance.view"))):
    return await sdb.bl_amounts.find({}, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(5000)


@api.post("/bl-amounts")
async def create_bl_amount(body: BLAmountIn, user: dict = Depends(require("finance.edit"))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await sdb.bl_amounts.insert_one(doc)
    await audit(user, "create", "bl_amount", f"BL Amount {body.bl_amount} for {body.invoice_number or body.container_no}")
    doc.pop("_id", None)
    return doc


@api.put("/bl-amounts/{bid}")
async def update_bl_amount(bid: str, body: BLAmountIn, user: dict = Depends(require("finance.edit"))):
    existing = await sdb.bl_amounts.find_one({"id": bid})
    if not existing:
        raise HTTPException(status_code=404, detail="BL Amount entry not found")
    await sdb.bl_amounts.update_one({"id": bid}, {"$set": body.model_dump()})
    await audit(user, "update", "bl_amount", f"Updated BL Amount {bid}")
    return {"ok": True}


@api.delete("/bl-amounts/{bid}")
async def delete_bl_amount(bid: str, user: dict = Depends(require("finance.edit"))):
    existing = await sdb.bl_amounts.find_one({"id": bid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="BL Amount entry not found")
    await sdb.bl_amounts.delete_one({"id": bid})
    await audit(user, "delete", "bl_amount", f"Deleted BL Amount {bid}")
    return {"ok": True}


# ---------------- Monthly Business Summary (isolated monthly totals) ----------------
# This is a checking / management summary. It deliberately does not alter stock, sales,
# purchases, invoices, customers, or any other operational collection. Users enter only
# monthly totals. Profit is provisional and TT is shown only as a collection position.


def _fiscal_start_month(company_id: str) -> int:
    # MTC: July -> June. TSK: June -> May.
    return 7 if company_id == "MTC" else 6


def _current_fiscal_year_start(company_id: str) -> int:
    now = datetime.now(timezone.utc)
    start_month = _fiscal_start_month(company_id)
    return now.year if now.month >= start_month else now.year - 1


def _fiscal_month_pairs(company_id: str, fiscal_year_start: int):
    start_month = _fiscal_start_month(company_id)
    pairs = []
    for offset in range(12):
        m = ((start_month - 1 + offset) % 12) + 1
        y = fiscal_year_start if m >= start_month else fiscal_year_start + 1
        pairs.append((y, m))
    return pairs


def _period_label(fiscal_year_start: int) -> str:
    return f"{fiscal_year_start}-{str(fiscal_year_start + 1)[-2:]}"


def _summary_values(doc: dict, opening_stock_override: Optional[float] = None) -> dict:
    opening_stock = round(float(
        doc.get("opening_stock") if opening_stock_override is None else opening_stock_override
    ) or 0, 2)
    buying = round(float(doc.get("buying") or 0), 2)
    export_sales = round(float(doc.get("export_sales") or 0), 2)
    local_sales = round(float(doc.get("local_sales") or 0), 2)
    tt_received = round(float(doc.get("tt_received") or 0), 2)
    shipping_cost = round(float(doc.get("shipping_cost") or 0), 2)
    salary = round(float(doc.get("salary") or 0), 2)
    rent_expenses = round(float(doc.get("rent_expenses") or 0), 2)
    closing_stock = round(float(doc.get("closing_stock") or 0), 2)
    total_sales = round(export_sales + local_sales, 2)
    cogs = round(opening_stock + buying - closing_stock, 2)
    total_cost = round(cogs + shipping_cost + salary + rent_expenses, 2)
    provisional_profit = round(total_sales - total_cost, 2)
    profit_margin_pct = round((provisional_profit / total_sales * 100), 2) if total_sales else 0.0
    return {
        "opening_stock": opening_stock, "buying": buying, "export_sales": export_sales,
        "local_sales": local_sales, "tt_received": tt_received, "shipping_cost": shipping_cost,
        "salary": salary, "rent_expenses": rent_expenses, "closing_stock": closing_stock,
        "cogs": cogs, "total_sales": total_sales, "total_cost": total_cost,
        "provisional_profit": provisional_profit, "profit_margin_pct": profit_margin_pct,
    }


def _tt_position(export_total: float, tt_total: float) -> dict:
    diff = round(float(tt_total or 0) - float(export_total or 0), 2)
    if diff > 0:
        return {"status": "over", "amount": diff, "difference": diff}
    if diff < 0:
        return {"status": "outstanding", "amount": abs(diff), "difference": diff}
    return {"status": "matched", "amount": 0.0, "difference": 0.0}


@api.get("/monthly-summary/years")
async def monthly_summary_years(user: dict = Depends(require("finance.view"))):
    rows = await sdb.monthly_summaries.find({}, {"_id": 0, "fiscal_year_start": 1}).to_list(5000)
    metas = await sdb.monthly_summary_years.find({}, {"_id": 0}).to_list(200)
    years = {int(r.get("fiscal_year_start")) for r in rows if r.get("fiscal_year_start") is not None}
    years.update(int(r.get("fiscal_year_start")) for r in metas if r.get("fiscal_year_start") is not None)
    current = _current_fiscal_year_start(current_company.get())
    years.add(current)
    meta_map = {int(m["fiscal_year_start"]): m for m in metas if m.get("fiscal_year_start") is not None}
    out = []
    for y in sorted(years, reverse=True):
        meta = meta_map.get(y, {})
        out.append({
            "fiscal_year_start": y,
            "label": _period_label(y),
            "closed": bool(meta.get("closed", False)),
        })
    return {"company": current_company.get(), "current_fiscal_year_start": current, "years": out}


@api.post("/monthly-summary/years/{fiscal_year_start}")
async def create_monthly_summary_year(fiscal_year_start: int, user: dict = Depends(require("finance.edit"))):
    if fiscal_year_start < 2000 or fiscal_year_start > 2200:
        raise HTTPException(status_code=400, detail="Invalid fiscal year")
    existing = await sdb.monthly_summary_years.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0})
    if not existing:
        await sdb.monthly_summary_years.insert_one({
            "id": new_id(), "fiscal_year_start": fiscal_year_start, "closed": False,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        await audit(user, "create", "monthly_summary_year", f"Created fiscal year {_period_label(fiscal_year_start)}")
    return {"ok": True, "fiscal_year_start": fiscal_year_start, "label": _period_label(fiscal_year_start)}


@api.get("/monthly-summary/{fiscal_year_start}")
async def get_monthly_summary(fiscal_year_start: int, user: dict = Depends(require("finance.view"))):
    company_id = current_company.get()
    pairs = _fiscal_month_pairs(company_id, fiscal_year_start)
    rows = await sdb.monthly_summaries.find({"fiscal_year_start": fiscal_year_start}, {"_id": 0}).to_list(100)
    by_month = {int(r.get("month")): r for r in rows if r.get("month") is not None}
    meta = await sdb.monthly_summary_years.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0}) or {}

    months = []
    cumulative_export = 0.0
    cumulative_tt = 0.0
    annual_raw = {k: 0.0 for k in ["buying", "export_sales", "local_sales", "tt_received", "shipping_cost", "salary", "rent_expenses"]}
    start_month = _fiscal_start_month(company_id)
    previous_closing = 0.0
    for calendar_year, month in pairs:
        raw = by_month.get(month)
        raw_for_calc = dict(raw or {})
        # The fiscal year's first month is entered manually. Every later month's
        # Opening Stock is linked to the previous month's Closing Stock.
        opening_stock = float(raw_for_calc.get("opening_stock") or 0) if month == start_month else previous_closing
        # An untouched future month carries stock forward unchanged. This keeps
        # YTD/annual figures correct before all 12 months have been entered.
        if raw is None:
            raw_for_calc["closing_stock"] = opening_stock
        vals = _summary_values(raw_for_calc, opening_stock_override=opening_stock)
        previous_closing = vals["closing_stock"]
        for k in annual_raw:
            annual_raw[k] += vals[k]
        cumulative_export += vals["export_sales"]
        cumulative_tt += vals["tt_received"]
        months.append({
            "id": raw.get("id") if raw else None,
            "fiscal_year_start": fiscal_year_start,
            "calendar_year": calendar_year,
            "month": month,
            "opening_stock_manual": month == start_month,
            **vals,
            "tt_ytd": _tt_position(cumulative_export, cumulative_tt),
            "updated_at": raw.get("updated_at") if raw else None,
        })

    first_opening = months[0]["opening_stock"] if months else 0.0
    last_closing = months[-1]["closing_stock"] if months else 0.0
    annual = _summary_values(
        {**annual_raw, "opening_stock": first_opening, "closing_stock": last_closing},
        opening_stock_override=first_opening,
    )
    annual["tt_position"] = _tt_position(annual["export_sales"], annual["tt_received"])
    return {
        "company": company_id,
        "fiscal_year_start": fiscal_year_start,
        "label": _period_label(fiscal_year_start),
        "start_month": _fiscal_start_month(company_id),
        "closed": bool(meta.get("closed", False)),
        "closed_at": meta.get("closed_at"),
        "has_data": bool(rows or meta),
        "months": months,
        "annual": annual,
    }


@api.put("/monthly-summary/{fiscal_year_start}/{month}")
async def update_monthly_summary(fiscal_year_start: int, month: int, body: MonthlySummaryIn,
                                 user: dict = Depends(require("finance.edit"))):
    company_id = current_company.get()
    valid_months = {m for _, m in _fiscal_month_pairs(company_id, fiscal_year_start)}
    if month not in valid_months:
        raise HTTPException(status_code=400, detail="Month does not belong to this fiscal year")
    meta = await sdb.monthly_summary_years.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0})
    if meta and meta.get("closed"):
        raise HTTPException(status_code=409, detail="Fiscal year is closed. Reopen it before editing.")

    start_month = _fiscal_start_month(company_id)
    calendar_year = fiscal_year_start if month >= start_month else fiscal_year_start + 1
    doc = body.model_dump()
    for key in doc:
        doc[key] = round(max(0.0, float(doc[key] or 0)), 2)
    # Only the first month of a fiscal year owns a manually entered Opening Stock.
    # Later months derive it from the previous month's Closing Stock on read/calculation.
    if month != start_month:
        doc["opening_stock"] = 0.0
    existing = await sdb.monthly_summaries.find_one({"fiscal_year_start": fiscal_year_start, "month": month}, {"_id": 0})
    if existing:
        await sdb.monthly_summaries.update_one(
            {"fiscal_year_start": fiscal_year_start, "month": month},
            {"$set": {**doc, "calendar_year": calendar_year, "updated_at": now_iso()}},
        )
    else:
        await sdb.monthly_summaries.insert_one({
            "id": new_id(), "fiscal_year_start": fiscal_year_start, "calendar_year": calendar_year,
            "month": month, **doc, "created_at": now_iso(), "updated_at": now_iso(),
        })
    # Ensure the fiscal year exists in metadata once the first month is saved.
    if not meta:
        await sdb.monthly_summary_years.insert_one({
            "id": new_id(), "fiscal_year_start": fiscal_year_start, "closed": False,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
    await audit(user, "update", "monthly_summary", f"Saved {calendar_year}-{month:02d} totals for {_period_label(fiscal_year_start)}")
    return {"ok": True}


@api.post("/monthly-summary/{fiscal_year_start}/close")
async def close_monthly_summary_year(fiscal_year_start: int, user: dict = Depends(require("finance.edit"))):
    existing = await sdb.monthly_summary_years.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0})
    payload = {"closed": True, "closed_at": now_iso(), "updated_at": now_iso()}
    if existing:
        await sdb.monthly_summary_years.update_one({"fiscal_year_start": fiscal_year_start}, {"$set": payload})
    else:
        await sdb.monthly_summary_years.insert_one({
            "id": new_id(), "fiscal_year_start": fiscal_year_start, "created_at": now_iso(), **payload,
        })
    await audit(user, "close", "monthly_summary_year", f"Closed fiscal year {_period_label(fiscal_year_start)}")
    return {"ok": True}


@api.post("/monthly-summary/{fiscal_year_start}/reopen")
async def reopen_monthly_summary_year(fiscal_year_start: int, user: dict = Depends(require("finance.edit"))):
    existing = await sdb.monthly_summary_years.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0})
    payload = {"closed": False, "closed_at": None, "updated_at": now_iso()}
    if existing:
        await sdb.monthly_summary_years.update_one({"fiscal_year_start": fiscal_year_start}, {"$set": payload})
    else:
        await sdb.monthly_summary_years.insert_one({
            "id": new_id(), "fiscal_year_start": fiscal_year_start, "created_at": now_iso(), **payload,
        })
    await audit(user, "reopen", "monthly_summary_year", f"Reopened fiscal year {_period_label(fiscal_year_start)}")
    return {"ok": True}


@api.get("/container-tt/summary")
async def container_tt_summary(user: dict = Depends(require("finance.view"))):
    invs = await sdb.container_invoices.find({}, {"_id": 0}).to_list(2000)
    tts = await sdb.income_tt.find({}, {"_id": 0}).to_list(5000)
    total_invoice = round(sum(_ci_total(i) for i in invs), 2)
    total_tt = round(sum(float(t.get("income_tt_amount") or 0) for t in tts), 2)
    cum = {}
    for t in tts:
        k = t.get("invoice_number")
        cum[k] = cum.get(k, 0) + float(t.get("income_tt_amount") or 0)
    # Overall current position for this standalone module. TT can arrive before
    # its invoice exists, so later invoices must absorb that earlier advance.
    net = round(total_invoice - total_tt, 2)
    total_due = max(net, 0.0)
    total_over = max(-net, 0.0)
    return {
        "total_invoice_amount": total_invoice,
        "total_tt_received": total_tt,
        "total_due": round(total_due, 2),
        "total_over": round(total_over, 2),
        "invoice_count": len(invs),
        "tt_count": len(tts),
    }


# ---------------- Invoices ----------------
async def next_invoice_number():
    s = await sdb.settings.find_one({"id": settings_id()}) or {}
    prefix = s.get("invoice_prefix", "MTC-")
    count = await sdb.invoices.count_documents({})
    return f"{prefix}{1000 + count + 1}"


@api.get("/invoices")
async def list_invoices(user: dict = Depends(require("finance.view"))):
    invs = await sdb.invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    cmap = {c["id"]: c["name"] for c in await sdb.customers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)}
    for i in invs:
        i["customer_name"] = cmap.get(i["customer_id"], "—")
    return invs


@api.post("/invoices")
async def create_invoice(body: InvoiceIn, user: dict = Depends(require("finance.edit"))):
    settings = await sdb.settings.find_one({"id": settings_id()}) or {}
    tax_rate = body.tax_rate if body.tax_rate is not None else settings.get("tax_rate", 10.0)
    # Entered prices are TAX-INCLUSIVE: the line total IS what the customer pays.
    inclusive_total = round(sum(it.quantity * it.unit_price for it in body.items), 2)
    before_tax = round(inclusive_total / (1 + tax_rate / 100), 2) if tax_rate else inclusive_total
    tax = round(inclusive_total - before_tax, 2)
    total = inclusive_total
    inv_no = await next_invoice_number()
    # Editable business date: use chosen sale_date; timestamp used by summaries/history.
    created_at = (body.sale_date + "T12:00:00") if body.sale_date else now_iso()
    # Engine / H-C items use tracked_parts inventory. Verify availability before
    # creating the invoice so a stale browser cannot sell an already-sold item.
    for it in body.items:
        if it.item_type in ("engine", "half_cut") and it.ref_id:
            tp = await sdb.tracked_parts.find_one({"id": it.ref_id}, {"_id": 0})
            if not tp or tp.get("part_type") != it.item_type:
                raise HTTPException(status_code=400, detail="Engine / H-C item not found")
            if tp.get("status") != "available":
                raise HTTPException(status_code=400, detail="This Engine / H-C item is already sold")

    doc = {"id": new_id(), "invoice_number": inv_no, "customer_id": body.customer_id,
           "items": [it.model_dump() for it in body.items], "subtotal": before_tax,
           "tax_rate": tax_rate, "tax": tax, "total": total, "tax_inclusive": True,
           "amount_paid": body.amount_paid, "payment_method": body.payment_method, "notes": body.notes,
           "sale_date": body.sale_date or created_at[:10],
           "created_at": created_at, "created_by": user["name"]}
    await sdb.invoices.insert_one(doc)
    # mark sold items
    for it in body.items:
        if it.item_type == "vehicle" and it.ref_id:
            await sdb.vehicles.update_one({"id": it.ref_id}, {"$set": {
                "status": "sold_complete", "sale_price": it.unit_price,
                "sale_date": created_at[:10], "customer_id": body.customer_id,
                "amount_received": body.amount_paid,
                "balance_due": round(it.unit_price - body.amount_paid, 2),
                "invoice_id": doc["id"]}})
        elif it.item_type == "part" and it.ref_id:
            await sdb.parts.update_one({"id": it.ref_id, "quantity": {"$gte": it.quantity}},
                                      {"$inc": {"quantity": -int(it.quantity)}})
        elif it.item_type in ("engine", "half_cut") and it.ref_id:
            await sdb.tracked_parts.update_one({"id": it.ref_id, "status": "available"}, {"$set": {
                "status": "sold", "sale_price": it.unit_price, "sale_date": created_at[:10],
                "customer_id": body.customer_id, "amount_received": 0,
                "balance_due": it.unit_price, "invoice_id": doc["id"]}})
    await audit(user, "create", "invoice", f"Created invoice {inv_no} total {total}")
    if body.amount_paid > 0:
        await fund_upsert("invoice_initial_payment", doc["id"], "in", body.amount_paid,
                          body.payment_method, body.sale_date or created_at[:10],
                          "customer_receipt", f"Initial payment on invoice {inv_no}")
    doc.pop("_id", None)
    return doc


@api.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, request: Request):
    # allow token via query for direct download links
    token = request.query_params.get("token")
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            u = await sdb.users.find_one({"id": payload["sub"]})
            if not u:
                raise HTTPException(status_code=401, detail="Invalid token")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")
    else:
        await get_current_user(request)
    inv = await sdb.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    settings = await sdb.settings.find_one({"id": settings_id()}, {"_id": 0}) or CompanySettings().model_dump()
    customer = await sdb.customers.find_one({"id": inv["customer_id"]}, {"_id": 0}) or {}
    pdf = build_invoice_pdf(inv, settings, customer)
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{inv["invoice_number"]}.pdf"'})


# ---------------- Payments ----------------
@api.get("/payments")
async def list_payments(user: dict = Depends(require("finance.view"))):
    pays = await sdb.payments.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    for p in pays:
        c = await sdb.customers.find_one({"id": p["customer_id"]}, {"_id": 0})
        p["customer_name"] = c["name"] if c else "—"
    return pays


@api.post("/payments")
async def create_payment(body: PaymentIn, user: dict = Depends(require("finance.edit"))):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
    pay_date = body.date or now_iso()[:10]
    if body.invoice_id:
        inv = await sdb.invoices.find_one({"id": body.invoice_id}, {"_id": 0})
        if not inv or inv.get("customer_id") != body.customer_id:
            raise HTTPException(status_code=400, detail="Invoice does not belong to this customer")
        remaining = round(float(inv.get("total") or 0) - float(inv.get("amount_paid") or 0), 2)
        if body.amount > remaining + 0.0001:
            raise HTTPException(status_code=400, detail=f"Payment exceeds invoice balance ({remaining})")
    doc = body.model_dump()
    doc.update({"id": new_id(), "date": pay_date, "created_at": now_iso(), "created_by": user["name"]})
    await sdb.payments.insert_one(doc)
    if body.invoice_id:
        await sdb.invoices.update_one({"id": body.invoice_id}, {"$inc": {"amount_paid": body.amount}})
        inv = await sdb.invoices.find_one({"id": body.invoice_id}, {"_id": 0})
        if inv:
            for it in inv.get("items", []):
                if it.get("item_type") == "vehicle" and it.get("ref_id"):
                    await sdb.vehicles.update_one({"id": it["ref_id"]}, {"$inc": {"amount_received": body.amount, "balance_due": -body.amount}})
    await fund_upsert("customer_payment", doc["id"], "in", body.amount, body.method,
                      pay_date, "customer_receipt", "Customer payment")
    await audit(user, "create", "payment", f"Recorded payment {body.amount}")
    doc.pop("_id", None)
    return doc


async def record_payment_revision(user: dict, kind: str, action: str, old: dict, new: Optional[dict] = None):
    """Append-only correction record. Existing backup ZIP remains unchanged."""
    await sdb.payment_revisions.insert_one({
        "id": new_id(), "kind": kind, "action": action,
        "original_id": old["id"], "before": old, "after": new,
        "user_id": user["id"], "user_name": user["name"], "at": now_iso(),
    })


async def adjust_customer_invoice_payment(invoice_id: str, amount_delta: float, customer_id: str):
    """Apply only the difference to pre-existing linked invoice/vehicle balances."""
    if not invoice_id or abs(amount_delta) < 0.000001:
        return
    inv = await sdb.invoices.find_one({"id": invoice_id, "customer_id": customer_id}, {"_id": 0})
    if not inv:
        raise HTTPException(409, "Linked invoice is missing; payment cannot be changed safely")
    new_paid = round(float(inv.get("amount_paid") or 0) + amount_delta, 2)
    if new_paid < -0.0001 or new_paid > float(inv.get("total") or 0) + 0.0001:
        raise HTTPException(409, "Payment correction would exceed invoice total or make paid amount negative")
    await sdb.invoices.update_one({"id": invoice_id}, {"$inc": {"amount_paid": amount_delta}})
    for it in inv.get("items", []):
        if it.get("item_type") == "vehicle" and it.get("ref_id"):
            await sdb.vehicles.update_one({"id": it["ref_id"]}, {"$inc": {"amount_received": amount_delta, "balance_due": -amount_delta}})


@api.put("/payments/{pid}")
async def correct_customer_payment(pid: str, body: PaymentCorrectionIn, user: dict = Depends(require("finance.edit"))):
    p = await sdb.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Payment not found")
    new = {"amount": round(body.amount, 2), "method": body.method, "date": body.date.isoformat(), "note": body.note or ""}
    delta = round(new["amount"] - float(p.get("amount") or 0), 2)
    # Retain customer and invoice association; reassignment is intentionally not part of this safe edit.
    if p.get("invoice_id"):
        inv = await sdb.invoices.find_one({"id": p["invoice_id"], "customer_id": p["customer_id"]}, {"_id": 0})
        if not inv:
            raise HTTPException(409, "Linked invoice missing")
        new_paid = round(float(inv.get("amount_paid") or 0) + delta, 2)
        if new_paid < -0.0001 or new_paid > float(inv.get("total") or 0) + 0.0001:
            raise HTTPException(409, "Correction exceeds remaining invoice balance")
    await record_payment_revision(user, "customer_payment", "edit", p, {**p, **new})
    await adjust_customer_invoice_payment(p.get("invoice_id"), delta, p["customer_id"])
    await sdb.payments.update_one({"id": pid}, {"$set": new})
    await fund_upsert("customer_payment", pid, "in", new["amount"], new["method"], new["date"], "customer_receipt", "Customer payment")
    await audit(user, "update", "payment", f"Corrected customer payment {pid}: {p.get('amount')} -> {new['amount']}")
    return {"ok": True}


@api.delete("/payments/{pid}")
async def delete_payment(pid: str, user: dict = Depends(require("finance.edit"))):
    p = await sdb.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    await record_payment_revision(user, "customer_payment", "delete", p)
    if p.get("invoice_id"):
        await sdb.invoices.update_one({"id": p["invoice_id"]}, {"$inc": {"amount_paid": -p["amount"]}})
        inv = await sdb.invoices.find_one({"id": p["invoice_id"]}, {"_id": 0})
        if inv:
            for it in inv.get("items", []):
                if it.get("item_type") == "vehicle" and it.get("ref_id"):
                    await sdb.vehicles.update_one({"id": it["ref_id"]}, {"$inc": {"amount_received": -p["amount"], "balance_due": p["amount"]}})
    await sdb.payments.delete_one({"id": pid})
    await fund_remove("customer_payment", pid)
    await audit(user, "delete", "payment", f"Voided payment {p['amount']}")
    return {"ok": True}


@api.delete("/invoices/{iid}")
async def delete_invoice(iid: str, user: dict = Depends(require("finance.edit"))):
    inv = await sdb.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    for it in inv["items"]:
        if it.get("item_type") == "vehicle" and it.get("ref_id"):
            await sdb.vehicles.update_one({"id": it["ref_id"]}, {"$set": {
                "status": "in_stock", "sale_price": 0, "sale_date": None, "customer_id": None,
                "amount_received": 0, "balance_due": 0, "invoice_id": None}})
        elif it.get("item_type") == "part" and it.get("ref_id"):
            await sdb.parts.update_one({"id": it["ref_id"]}, {"$inc": {"quantity": int(it.get("quantity", 0))}})
        elif it.get("item_type") in ("engine", "half_cut") and it.get("ref_id"):
            await sdb.tracked_parts.update_one({"id": it["ref_id"], "invoice_id": iid}, {"$set": {
                "status": "available", "sale_price": 0, "sale_date": None, "customer_id": None,
                "amount_received": 0, "balance_due": 0, "invoice_id": None}})
    await sdb.payments.update_many({"invoice_id": iid}, {"$set": {"invoice_id": None}})
    await sdb.invoices.delete_one({"id": iid})
    await fund_remove("invoice_initial_payment", iid)
    await audit(user, "delete", "invoice", f"Voided invoice {inv['invoice_number']} (inventory reverted)")
    return {"ok": True}


# ---------------- Expenses ----------------
@api.get("/expenses")
async def list_expenses(user: dict = Depends(require("finance.view"))):
    return await sdb.expenses.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)


@api.post("/expenses")
async def create_expense(body: ExpenseIn, user: dict = Depends(require("finance.edit"))):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    doc = body.model_dump()
    fund_category = "expense"
    fund_description = f"{body.category}: {body.description or ''}"

    # Shipping Cost is intentionally independent from Container & TT.
    # The free-text payment source is only a reference label; CASH affects Cash,
    # every other source name affects the single aggregated Bank balance.
    if body.category == "shipping":
        company_name = (body.company_name or "").strip()
        invoice_number = (body.invoice_number or "").strip()
        payment_source = (body.payment_source or "").strip()
        if not company_name or not invoice_number or not payment_source:
            raise HTTPException(status_code=400, detail="Company, invoice number and payment source are required")
        method = "cash" if payment_source.lower() == "cash" else "bank"
        doc.update({
            "company_name": company_name,
            "invoice_number": invoice_number,
            "payment_source": payment_source,
            "method": method,
        })
        fund_category = "shipping"
        fund_description = f"{company_name} | {invoice_number} | {payment_source}"
        if body.description:
            fund_description += f" | {body.description}"
    else:
        method = body.method

    doc.update({"id": new_id(), "date": body.date or now_iso()[:10], "created_at": now_iso()})
    await sdb.expenses.insert_one(doc)
    await fund_upsert("expense", doc["id"], "out", body.amount, method, doc["date"],
                      fund_category, fund_description)
    await audit(user, "create", "expense", f"{body.category}: {body.amount}")
    doc.pop("_id", None)
    return doc


@api.delete("/expenses/{eid}")
async def delete_expense(eid: str, user: dict = Depends(require("finance.edit"))):
    await sdb.expenses.delete_one({"id": eid})
    await fund_remove("expense", eid)
    return {"ok": True}


# Customer-recoverable shipping: NOT an expense or a sale. Container & TT stays isolated.
@api.get("/customer-shipping")
async def list_customer_shipping(user: dict = Depends(require("finance.view"))):
    return await sdb.customer_shipping.find({}, {"_id": 0}).sort("date", -1).to_list(5000)


@api.post("/customer-shipping")
async def create_customer_shipping(body: CustomerShippingIn, user: dict = Depends(require("finance.edit"))):
    if body.amount <= 0 or body.method not in ("cash", "bank") or not body.date or not body.container_number.strip():
        raise HTTPException(status_code=400, detail="Date, container, positive amount and Cash/Bank required")
    customer = await sdb.customers.find_one({"id": body.customer_id}, {"_id": 0, "name": 1})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    doc = body.model_dump()
    doc.update({"id": new_id(), "container_number": body.container_number.strip(), "created_at": now_iso()})
    await sdb.customer_shipping.insert_one(doc)
    await fund_upsert("customer_shipping", doc["id"], "out", body.amount, body.method, body.date,
                      "customer_shipping", f"Recoverable shipping {customer['name']} | {doc['container_number']}")
    await audit(user, "create", "customer_shipping", f"{customer['name']}: {body.amount}")
    doc.pop("_id", None)
    return doc


@api.put("/customer-shipping/{sid}")
async def update_customer_shipping(sid: str, body: CustomerShippingIn, user: dict = Depends(require("finance.edit"))):
    old = await sdb.customer_shipping.find_one({"id": sid}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Shipping record not found")
    if body.amount <= 0 or body.method not in ("cash", "bank") or not body.date or not body.container_number.strip():
        raise HTTPException(status_code=400, detail="Date, container, positive amount and Cash/Bank required")
    customer = await sdb.customers.find_one({"id": body.customer_id}, {"_id": 0, "name": 1})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    update = body.model_dump()
    update["container_number"] = body.container_number.strip()
    await sdb.customer_shipping.update_one({"id": sid}, {"$set": update})
    await fund_upsert("customer_shipping", sid, "out", body.amount, body.method, body.date,
                      "customer_shipping", f"Recoverable shipping {customer['name']} | {update['container_number']}")
    await audit(user, "update", "customer_shipping", sid)
    return {"ok": True}


@api.delete("/customer-shipping/{sid}")
async def delete_customer_shipping(sid: str, user: dict = Depends(require("finance.edit"))):
    old = await sdb.customer_shipping.find_one({"id": sid}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Shipping record not found")
    await sdb.customer_shipping.delete_one({"id": sid})
    await fund_remove("customer_shipping", sid)
    await audit(user, "delete", "customer_shipping", sid)
    return {"ok": True}


# ---------------- Employees & Salaries ----------------
@api.get("/employees")
async def list_employees(user: dict = Depends(require("finance.view"))):
    return await sdb.employees.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api.post("/employees")
async def create_employee(body: EmployeeIn, user: dict = Depends(require("finance.edit"))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await sdb.employees.insert_one(doc)
    await audit(user, "create", "employee", f"Added employee {body.name}")
    doc.pop("_id", None)
    return doc


@api.delete("/employees/{eid}")
async def delete_employee(eid: str, user: dict = Depends(require("finance.edit"))):
    await sdb.employees.delete_one({"id": eid})
    return {"ok": True}


@api.get("/salaries")
async def list_salaries(user: dict = Depends(require("finance.view"))):
    sals = await sdb.salaries.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    emap = {e["id"]: e["name"] for e in await sdb.employees.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)}
    for s in sals:
        # Preserve historical salary names even if an employee record is later removed.
        s["employee_name"] = emap.get(s["employee_id"], s.get("employee_name") or "—")
    return sals


@api.post("/salaries")
async def pay_salary(body: SalaryIn, user: dict = Depends(require("finance.edit"))):
    emp = await sdb.employees.find_one({"id": body.employee_id}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    doc = body.model_dump()
    doc.update({"id": new_id(), "employee_name": emp.get("name", ""),
                "date": body.date or now_iso()[:10], "created_at": now_iso()})
    await sdb.salaries.insert_one(doc)
    await fund_upsert("salary", doc["id"], "out", body.amount, body.method, doc["date"],
                      "salary", f"Salary {emp.get('name','')} {body.month}")
    await audit(user, "create", "salary", f"Paid salary {body.amount} for {body.month}")
    doc.pop("_id", None)
    return doc


# ---------------- Reports & Dashboard ----------------
async def compute_pnl(start=None, end=None):
    q = {}
    if start or end:
        rng = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end + "T23:59:59"
        q["created_at"] = rng
    invoices = await sdb.invoices.find(q, {"_id": 0}).to_list(5000)
    # Sales recorded at the tax-INCLUSIVE amount the customer pays; tax shown separately.
    sales_revenue = sum(i.get("total", i.get("subtotal", 0)) for i in invoices)
    tax_collected = sum(i["tax"] for i in invoices)
    # COGS: cost of sold vehicles + cost of sold parts (via invoice items)
    cogs = 0.0
    vmap = {v["id"]: v.get("purchase_price", 0) for v in await sdb.vehicles.find({}, {"_id": 0, "id": 1, "purchase_price": 1}).to_list(20000)}
    pmap = {p["id"]: p.get("unit_cost", 0) for p in await sdb.parts.find({}, {"_id": 0, "id": 1, "unit_cost": 1}).to_list(20000)}
    for inv in invoices:
        for it in inv["items"]:
            if it.get("item_type") == "vehicle" and it.get("ref_id"):
                cogs += vmap.get(it["ref_id"], 0)
            elif it.get("item_type") == "part" and it.get("ref_id"):
                cogs += pmap.get(it["ref_id"], 0) * it.get("quantity", 1)
    eq = {"created_at": q["created_at"]} if q else {}
    expenses = sum(e["amount"] for e in await sdb.expenses.find(eq, {"_id": 0}).to_list(5000))
    salaries = sum(s["amount"] for s in await sdb.salaries.find({"date": q["created_at"]} if q else {}, {"_id": 0}).to_list(5000))
    gross_profit = sales_revenue - cogs
    net_profit = gross_profit - expenses - salaries
    return {"sales_revenue": round(sales_revenue, 2), "tax_collected": round(tax_collected, 2),
            "cogs": round(cogs, 2), "gross_profit": round(gross_profit, 2),
            "expenses": round(expenses, 2), "salaries": round(salaries, 2),
            "net_profit": round(net_profit, 2)}


def _prev_day(d):
    try:
        return (datetime.strptime(d[:10], "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    except Exception:
        return "2000-01-01"


async def recovered_asof(v, asof):
    vid = v["id"]
    hi = asof + "T23:59:59"
    rec = 0.0
    for t in await sdb.tracked_parts.find({"source_vehicle_id": vid, "status": "sold", "sale_date": {"$lte": hi}}, {"_id": 0, "sale_price": 1}).to_list(500):
        rec += t.get("sale_price", 0)
    for p in await sdb.part_sales.find({"source_vehicle_id": vid, "date": {"$lte": hi}}, {"_id": 0, "sale_price": 1}).to_list(500):
        rec += p.get("sale_price", 0)
    async for a in sdb.scrap_allocations.find({"vehicle_ids": vid, "date": {"$lte": hi}}, {"_id": 0, "per_vehicle": 1}):
        rec += a.get("per_vehicle", 0)
    async for a in sdb.shokubai_allocations.find({"vehicle_ids": vid, "sale_date": {"$lte": hi}}, {"_id": 0, "per_vehicle": 1}):
        rec += a.get("per_vehicle", 0)
    if v.get("status") in ("sold", "sold_complete") and (v.get("sale_date") or "") <= hi:
        rec += v.get("sale_price", 0)
    return rec


async def stock_value_asof(asof):
    """Point-in-time inventory value at COST (unsold only)."""
    hi = asof + "T23:59:59"
    total = 0.0
    vs = await sdb.vehicles.find({"purchase_date": {"$lte": hi}}, {"_id": 0}).to_list(50000)
    for v in vs:
        pp = v.get("purchase_price", 0)
        if v.get("status") in ("sold", "sold_complete") and (v.get("sale_date") or "") <= hi:
            continue  # sold, not in stock
        if v.get("status") == "dismantled" and (v.get("dismantle_date") or "") <= hi:
            total += max(0, pp - await recovered_asof(v, asof))  # remaining unrecovered cost
        else:
            total += pp  # still complete-in-stock as of asof
    for t in await sdb.tracked_parts.find({"source": "direct", "date": {"$lte": hi}}, {"_id": 0}).to_list(50000):
        if t.get("status") == "sold" and (t.get("sale_date") or "") <= hi:
            continue
        total += t.get("purchase_price", 0)
    for p in await sdb.parts.find({"created_at": {"$lte": hi}}, {"_id": 0, "unit_cost": 1, "quantity": 1}).to_list(50000):
        total += p.get("unit_cost", 0) * p.get("quantity", 0)
    return round(total, 2)


async def compute_stock_valuation():
    asof = now_iso()[:10]
    veh = await sdb.vehicles.find({"status": "in_stock"}, {"_id": 0, "purchase_price": 1}).to_list(50000)
    veh_value = sum(v.get("purchase_price", 0) for v in veh)
    parts = await sdb.parts.find({}, {"_id": 0, "unit_cost": 1, "quantity": 1}).to_list(50000)
    parts_value = sum(p.get("unit_cost", 0) * p.get("quantity", 0) for p in parts)
    standalone = await sdb.tracked_parts.find({"source": "direct", "status": "available"}, {"_id": 0, "purchase_price": 1}).to_list(50000)
    standalone_value = sum(t.get("purchase_price", 0) for t in standalone)
    dismantled = await sdb.vehicles.find({"status": "dismantled"}, {"_id": 0, "id": 1, "purchase_price": 1, "status": 1}).to_list(50000)
    dismantled_remaining = 0.0
    for v in dismantled:
        dismantled_remaining += max(0, v.get("purchase_price", 0) - await recovered_asof(v, asof))
    total = veh_value + parts_value + standalone_value + dismantled_remaining
    return {"vehicles_count": len(veh), "vehicles_value": round(veh_value, 2),
            "parts_count": sum(p.get("quantity", 0) for p in parts), "parts_value": round(parts_value, 2),
            "standalone_value": round(standalone_value, 2), "dismantled_remaining": round(dismantled_remaining, 2),
            "total_value": round(total, 2)}


@api.get("/reports/pnl")
async def report_pnl(start: Optional[str] = None, end: Optional[str] = None,
                     user: dict = Depends(require("reports.view"))):
    return await compute_pnl(start, end)


@api.get("/reports/stock")
async def report_stock(user: dict = Depends(require("reports.view"))):
    return await compute_stock_valuation()


async def auth_or_token(request: Request):
    token = request.query_params.get("token")
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            if not await sdb.users.find_one({"id": payload["sub"]}):
                raise HTTPException(status_code=401, detail="Invalid token")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")
        return
    await get_current_user(request)


@api.get("/reports/pnl/pdf")
async def report_pnl_pdf(request: Request):
    await auth_or_token(request)
    pnl = await compute_pnl()
    stock = await compute_stock_valuation()
    settings = await sdb.settings.find_one({"id": settings_id()}, {"_id": 0}) or CompanySettings().model_dump()
    pdf = build_report_pdf(pnl, stock, settings)
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": 'attachment; filename="MTC-financial-report.pdf"'})


@api.get("/alerts")
async def alerts(user: dict = Depends(require("dashboard.view"))):
    low_stock = await sdb.parts.find({"quantity": {"$lte": 3}}, {"_id": 0}).to_list(500)
    overdue = []
    if "customers.view" in user.get("permissions", []) or "finance.view" in user.get("permissions", []):
        balances = await compute_balances_bulk()
        customers = await sdb.customers.find({}, {"_id": 0}).to_list(2000)
        for c in customers:
            b = balances.get(c["id"])
            if b and b["outstanding"] > 0:
                overdue.append({"id": c["id"], "name": c["name"], "phone": c.get("phone", ""),
                                "outstanding": b["outstanding"]})
    return {"low_stock": low_stock, "overdue": overdue,
            "count": len(low_stock) + len(overdue)}


@api.get("/export/{entity}")
async def export_csv(entity: str, request: Request):
    token = request.query_params.get("token")
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            if not await sdb.users.find_one({"id": payload["sub"]}):
                raise HTTPException(status_code=401, detail="Invalid token")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")
    else:
        await get_current_user(request)
    cols = {
        "vehicles": ["purchase_company", "chassis_number", "make", "model", "year", "engine_code", "engine_number", "purchase_date", "purchase_price", "status", "dismantle_date", "sale_price", "amount_received", "balance_due", "supplier"],
        "parts": ["purchase_company", "purchase_date", "name", "part_number", "category", "quantity", "unit_cost", "sale_price", "supplier", "location", "source_chassis"],
        "customers": ["name", "phone", "email", "address"],
        "invoices": ["invoice_number", "customer_id", "subtotal", "tax", "total", "amount_paid", "created_at"],
        "payments": ["customer_id", "amount", "method", "is_advance", "invoice_id", "created_at"],
        "expenses": ["date", "category", "company_name", "invoice_number", "amount", "payment_source", "method", "description"],
        "tracked_parts": ["purchase_company", "date", "part_type", "name", "engine_code", "engine_number", "chassis_number", "dismantle_date", "source", "supplier", "purchase_price", "status", "sale_date", "customer_id", "sale_price", "amount_received", "balance_due"],
        "part_sales": ["date", "category", "vehicle_name", "chassis_number", "part_name", "customer_id", "sale_price", "amount_received", "balance_due"],
        "scrap_allocations": ["month", "date", "total_amount", "vehicle_count", "per_vehicle"],
        "shokubai_allocations": ["prev_cutoff", "new_cutoff", "sale_date", "total_amount", "vehicle_count", "per_vehicle"],
        "small_sales": ["date", "item_name", "sold_to", "amount", "method", "note", "created_at", "updated_at"],
        "salaries": ["employee_id", "month", "amount", "note", "created_at"],
        "bl_amounts": ["date", "company_name", "final_destination", "container_no", "invoice_number", "bl_amount", "paid_amount", "paid_date", "surrender_date"],
        "monthly_summaries": ["fiscal_year_start", "calendar_year", "month", "opening_stock", "buying", "export_sales", "local_sales", "tt_received", "shipping_cost", "salary", "rent_expenses", "closing_stock", "updated_at"],
        "monthly_summary_years": ["fiscal_year_start", "closed", "closed_at", "created_at", "updated_at"],
    }
    if entity == "backup":
        import json as _json
        cid = current_company.get()
        data = {"company_id": cid}
        for coll in list(cols.keys()) + ["employees", "audit_logs", "settings", "roles"]:
            if coll == "roles":
                flt = {}
            elif coll == "settings":
                flt = {"id": settings_id()}
            elif coll in PER_COMPANY_COLLECTIONS:
                flt = {"company_id": cid}
            else:
                flt = {}
            data[coll] = await db[coll].find(flt, {"_id": 0}).to_list(50000)
        payload = _json.dumps(data, ensure_ascii=False, indent=2)
        return StreamingResponse(iter([payload]), media_type="application/json",
                                 headers={"Content-Disposition": f'attachment; filename="{cid}-backup-{now_iso()[:10]}.json"'})
    if entity not in cols:
        raise HTTPException(status_code=404, detail="Unknown export")
    cid = current_company.get()
    flt = {"company_id": cid} if entity in PER_COMPANY_COLLECTIONS else {}
    rows = await db[entity].find(flt, {"_id": 0}).to_list(20000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols[entity])
    for r in rows:
        w.writerow([r.get(c, "") for c in cols[entity]])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{cid}-{entity}.csv"'})


@api.get("/dashboard")
async def dashboard(user: dict = Depends(require("dashboard.view"))):
    pnl = await compute_pnl()
    stock = await compute_stock_valuation()
    vehicles_in = await sdb.vehicles.count_documents({"status": "in_stock"})
    vehicles_sold = await sdb.vehicles.count_documents({"status": {"$in": ["sold", "sold_complete"]}})
    vehicles_dismantled = await sdb.vehicles.count_documents({"status": "dismantled"})
    customers = await sdb.customers.count_documents({})
    invoices = await sdb.invoices.count_documents({})
    # outstanding total
    balances = await compute_balances_bulk()
    outstanding = sum(max(b["outstanding"], 0) for b in balances.values())
    recent = await sdb.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(8)
    today = now_iso()[:10]
    today_invoices = await sdb.invoices.find({"created_at": {"$gte": today}}, {"_id": 0}).to_list(2000)
    today_sales = sum(i["subtotal"] for i in today_invoices)
    today_pays = await sdb.payments.find({"created_at": {"$gte": today}}, {"_id": 0}).to_list(2000)
    today_payments = sum(p["amount"] for p in today_pays)
    low_stock_count = await sdb.parts.count_documents({"quantity": {"$lte": 3}})
    overdue_count = sum(1 for b in balances.values() if b["outstanding"] > 0)

    # Company tag counts for the four small dashboard cards only.
    # These do NOT change existing purchasing, stock, status, P&L, cash/bank,
    # customer, fiscal-year or summary calculations.
    legacy_mtc = {"$or": [
        {"purchase_company": "MTC"},
        {"purchase_company": {"$exists": False}},
        {"purchase_company": None},
        {"purchase_company": ""},
    ]}
    tsk_only = {"purchase_company": "TSK"}

    mtc_vehicle_count = await sdb.vehicles.count_documents(legacy_mtc)
    tsk_vehicle_count = await sdb.vehicles.count_documents(tsk_only)

    direct_part_filter = {"$or": [
        {"source_vehicle_id": {"$exists": False}},
        {"source_vehicle_id": None},
        {"source_vehicle_id": ""},
    ]}
    mtc_direct_parts = await sdb.parts.find(
        {"$and": [legacy_mtc, direct_part_filter]}, {"_id": 0, "quantity": 1, "purchased_quantity": 1}
    ).to_list(50000)
    tsk_direct_parts = await sdb.parts.find(
        {"$and": [tsk_only, direct_part_filter]}, {"_id": 0, "quantity": 1, "purchased_quantity": 1}
    ).to_list(50000)

    mtc_part_qty = sum(p.get("purchased_quantity", p.get("quantity", 0)) or 0 for p in mtc_direct_parts)
    tsk_part_qty = sum(p.get("purchased_quantity", p.get("quantity", 0)) or 0 for p in tsk_direct_parts)

    mtc_tracked_count = await sdb.tracked_parts.count_documents(
        {"$and": [legacy_mtc, {"source": "direct"}]}
    )
    tsk_tracked_count = await sdb.tracked_parts.count_documents(
        {"$and": [tsk_only, {"source": "direct"}]}
    )

    purchase_company_counts = {
        "MTC": {"vehicles": mtc_vehicle_count, "parts": mtc_part_qty + mtc_tracked_count},
        "TSK": {"vehicles": tsk_vehicle_count, "parts": tsk_part_qty + tsk_tracked_count},
    }

    return {"pnl": pnl, "stock": stock,
            "vehicles": {"in_stock": vehicles_in, "sold": vehicles_sold, "dismantled": vehicles_dismantled},
            "customers": customers, "invoices": invoices,
            "outstanding": round(outstanding, 2), "recent_activity": recent,
            "today_sales": round(today_sales, 2), "today_payments": round(today_payments, 2),
            "purchase_company_counts": purchase_company_counts,
            "alerts_count": low_stock_count + overdue_count}


@api.get("/audit")
async def audit_logs(user: dict = Depends(require("reports.view"))):
    return await sdb.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(500)


# ---------------- Recovery / Tracked Parts / Allocations / Summaries ----------------
async def compute_recovery(v):
    vid = v["id"]
    tracked = await sdb.tracked_parts.find({"source_vehicle_id": vid, "status": "sold"}, {"_id": 0}).to_list(200)
    engine_sales = [t for t in tracked if t["part_type"] == "engine"]
    halfcut_sales = [t for t in tracked if t["part_type"] == "half_cut"]
    engine_total = sum(t["sale_price"] for t in engine_sales)
    engine_recv = sum(t["amount_received"] for t in engine_sales)
    halfcut_total = sum(t["sale_price"] for t in halfcut_sales)
    halfcut_recv = sum(t["amount_received"] for t in halfcut_sales)
    scrap, scrap_refs = 0.0, []
    async for a in sdb.scrap_allocations.find({"vehicle_ids": vid}, {"_id": 0}):
        amount = float((a.get("vehicle_amounts") or {}).get(vid, a.get("per_vehicle", 0)) or 0)
        scrap += amount
        scrap_refs.append({"month": a["month"], "amount": amount, "id": a["id"]})
    shok, shok_refs = 0.0, []
    async for a in sdb.shokubai_allocations.find({"vehicle_ids": vid}, {"_id": 0}):
        shok += a["per_vehicle"]
        shok_refs.append({"period": f"{a['prev_cutoff']} → {a['new_cutoff']}", "amount": a["per_vehicle"], "id": a["id"]})
    part_sales = await sdb.part_sales.find({"source_vehicle_id": vid}, {"_id": 0}).to_list(500)
    ps_engine = [p for p in part_sales if p.get("category") == "engine"]
    ps_hcut = [p for p in part_sales if p.get("category") == "half_cut"]
    ps_parts = [p for p in part_sales if p.get("category", "parts") == "parts"]
    engine_total += sum(p.get("sale_price", 0) for p in ps_engine)
    engine_recv += sum(p.get("amount_received", 0) for p in ps_engine)
    halfcut_total += sum(p.get("sale_price", 0) for p in ps_hcut)
    halfcut_recv += sum(p.get("amount_received", 0) for p in ps_hcut)
    parts_total = sum(p.get("sale_price", 0) for p in ps_parts)
    parts_recv = sum(p.get("amount_received", 0) for p in ps_parts)
    complete_sale = v.get("sale_price", 0) if v.get("status") == "sold_complete" else 0
    total_recovered = engine_total + halfcut_total + parts_total + scrap + shok + complete_sale
    purchase = v.get("purchase_price", 0)
    return {
        "purchase_price": purchase,
        "engine": {"total": round(engine_total, 2), "received": round(engine_recv, 2), "sales": engine_sales + ps_engine},
        "half_cut": {"total": round(halfcut_total, 2), "received": round(halfcut_recv, 2), "sales": halfcut_sales + ps_hcut},
        "parts": {"total": round(parts_total, 2), "received": round(parts_recv, 2), "sales": ps_parts},
        "scrap": {"total": round(scrap, 2), "refs": scrap_refs},
        "shokubai": {"total": round(shok, 2), "refs": shok_refs},
        "complete_sale": complete_sale,
        "total_recovered": round(total_recovered, 2),
        "profit_loss": round(total_recovered - purchase, 2),
        "remaining_to_recover": round(max(purchase - total_recovered, 0), 2),
    }


@api.get("/tracked-parts")
async def list_tracked(type: Optional[str] = None, q: Optional[str] = None,
                       user: dict = Depends(require("parts.view"))):
    query = {}
    if type:
        query["part_type"] = type
    if q:
        query["$or"] = [
            {"engine_code": {"$regex": q, "$options": "i"}},
            {"engine_number": {"$regex": q, "$options": "i"}},
            {"chassis_number": {"$regex": q, "$options": "i"}},
            {"vehicle_name": {"$regex": q, "$options": "i"}},
        ]
    rows = await sdb.tracked_parts.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    cmap = {c["id"]: c["name"] for c in await sdb.customers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)}
    for r in rows:
        r["customer_name"] = cmap.get(r.get("customer_id"), "")
        r["purchase_company"] = purchase_company_or_default(r.get("purchase_company"))
    return rows


@api.post("/tracked-parts")
async def create_tracked(body: TrackedPurchaseIn, user: dict = Depends(get_current_user)):
    if not ("parts.edit" in user["permissions"] or "vehicles.edit" in user["permissions"]):
        raise HTTPException(status_code=403, detail="Permission denied")
    if body.part_type not in ("engine", "half_cut"):
        raise HTTPException(status_code=400, detail="Type must be engine or half_cut")
    d = body.date or now_iso()[:10]
    purchase_company = validate_purchase_company(body.purchase_company)
    doc = {"id": new_id(), "part_type": body.part_type, "source": "direct",
           "name": body.name, "vehicle_name": body.name, "supplier": body.supplier,
           "payment_method": body.payment_method, "purchase_company": purchase_company,
           "chassis_number": "", "engine_code": "", "engine_number": "",
           "source_vehicle_id": None, "purchase_date": d, "date": d, "dismantle_date": None,
           "purchase_price": body.purchase_price, "status": "available",
           "sale_date": None, "customer_id": None, "sale_price": 0,
           "amount_received": 0, "balance_due": 0, "created_at": now_iso()}
    await sdb.tracked_parts.insert_one(doc)
    await fund_upsert("tracked_purchase", doc["id"], "out", body.purchase_price,
                      body.payment_method, d, "parts_purchase",
                      f"Direct {body.part_type} purchase {body.name}")
    doc.pop("_id", None)
    await audit(user, "create", body.part_type,
                f"Direct purchase {body.part_type} '{body.name}' from {body.supplier} for {body.purchase_price}")
    return doc


@api.put("/tracked-parts/{tid}")
async def update_tracked_purchase(tid: str, body: TrackedPurchaseIn, user: dict = Depends(get_current_user)):
    if not ("parts.edit" in user["permissions"] or "vehicles.edit" in user["permissions"]):
        raise HTTPException(status_code=403, detail="Permission denied")
    if body.part_type not in ("engine", "half_cut"):
        raise HTTPException(status_code=400, detail="Type must be engine or half_cut")
    tp = await sdb.tracked_parts.find_one({"id": tid}, {"_id": 0})
    if not tp:
        raise HTTPException(status_code=404, detail="Not found")
    if tp.get("source") != "direct":
        raise HTTPException(status_code=400, detail="Only direct Engine / H-C purchases can be edited here")
    d = body.date or tp.get("date") or now_iso()[:10]
    # Keep the original inventory type when correcting an existing record so a typo edit
    # cannot turn an Engine into an H-C (or vice versa) after it has entered history.
    purchase_company = (purchase_company_or_default(tp.get("purchase_company"))
                        if body.purchase_company is None
                        else validate_purchase_company(body.purchase_company))
    updates = {"part_type": tp.get("part_type", body.part_type), "date": d, "purchase_date": d,
               "name": body.name, "vehicle_name": body.name, "supplier": body.supplier,
               "purchase_price": body.purchase_price, "payment_method": body.payment_method,
               "purchase_company": purchase_company}
    await sdb.tracked_parts.update_one({"id": tid}, {"$set": updates})
    await fund_upsert("tracked_purchase", tid, "out", body.purchase_price, body.payment_method,
                      d, "parts_purchase", f"Direct {body.part_type} purchase {body.name}")
    await audit(user, "update", body.part_type, f"Updated direct {body.part_type} purchase '{body.name}'")
    return {"ok": True}


@api.post("/tracked-parts/{tid}/sell")
async def sell_tracked(tid: str, body: TrackedSellIn, user: dict = Depends(get_current_user)):
    if not ("vehicles.edit" in user["permissions"] or "finance.edit" in user["permissions"]):
        raise HTTPException(status_code=403, detail="Permission denied")
    tp = await sdb.tracked_parts.find_one({"id": tid}, {"_id": 0})
    if not tp:
        raise HTTPException(status_code=404, detail="Not found")
    if tp["status"] == "sold":
        raise HTTPException(status_code=400, detail="This item is already sold")
    sale_date = body.sale_date or now_iso()[:10]
    bal = round(body.sale_price - body.amount_received, 2)
    await sdb.tracked_parts.update_one({"id": tid}, {"$set": {
        "status": "sold", "sale_date": sale_date, "customer_id": body.customer_id,
        "sale_price": body.sale_price, "amount_received": body.amount_received, "balance_due": bal}})
    # A dismantled vehicle cannot have Engine and Half Cut independently available after either is sold.
    # Mark only the sibling inventory row unavailable; do not create a second sale/accounting record.
    if tp.get("source_vehicle_id"):
        sibling_type = "half_cut" if tp.get("part_type") == "engine" else "engine"
        await sdb.tracked_parts.update_many(
            {"source_vehicle_id": tp["source_vehicle_id"], "part_type": sibling_type, "status": "available"},
            {"$set": {"status": "unavailable", "unavailable_due_to_sale_id": tid}})
    await fund_upsert("tracked_sale", tid, "in", body.amount_received, body.method,
                      sale_date, "parts_sale", f"Sold {tp.get('part_type')} {tp.get('name','')}")
    await audit(user, "sell", tp["part_type"],
                f"Sold {tp['part_type']} {tp.get('engine_code','')} from {tp['chassis_number']} for {body.sale_price} (recv {body.amount_received})")
    return {"ok": True, "balance_due": bal}


@api.put("/tracked-parts/{tid}/sale")
async def edit_tracked_sale(tid: str, body: TrackedSellIn, user: dict = Depends(require("records.reverse"))):
    tp = await sdb.tracked_parts.find_one({"id": tid}, {"_id": 0})
    if not tp or tp.get("status") != "sold":
        raise HTTPException(status_code=404, detail="Sold Engine / Half Cut record not found")
    if body.sale_price < 0 or body.amount_received < 0 or body.amount_received > body.sale_price:
        raise HTTPException(status_code=400, detail="Invalid sale/received amount")
    sale_date = body.sale_date or tp.get("sale_date") or now_iso()[:10]
    bal = round(body.sale_price - body.amount_received, 2)
    await sdb.tracked_parts.update_one({"id": tid}, {"$set": {
        "sale_date": sale_date, "customer_id": body.customer_id, "sale_price": body.sale_price,
        "amount_received": body.amount_received, "balance_due": bal}})
    await fund_upsert("tracked_sale", tid, "in", body.amount_received, body.method, sale_date,
                      "parts_sale", f"Corrected {tp.get('part_type')} sale")
    await audit(user, "correct", tp.get("part_type", "tracked_part"), f"Corrected sale {tid}")
    return {"ok": True, "balance_due": bal}


@api.post("/tracked-parts/{tid}/sale-reset")
async def reset_tracked_sale(tid: str, user: dict = Depends(require("records.reverse"))):
    tp = await sdb.tracked_parts.find_one({"id": tid}, {"_id": 0})
    if not tp or tp.get("status") != "sold":
        raise HTTPException(status_code=404, detail="Sold Engine / Half Cut record not found")
    await sdb.tracked_parts.update_one({"id": tid}, {"$set": {
        "status": "available", "sale_date": None, "customer_id": None, "sale_price": 0,
        "amount_received": 0, "balance_due": 0}, "$unset": {"unavailable_due_to_sale_id": ""}})
    if tp.get("source_vehicle_id"):
        await sdb.tracked_parts.update_many(
            {"source_vehicle_id": tp["source_vehicle_id"], "unavailable_due_to_sale_id": tid},
            {"$set": {"status": "available"}, "$unset": {"unavailable_due_to_sale_id": ""}})
    await fund_remove("tracked_sale", tid)
    await audit(user, "reverse", tp.get("part_type", "tracked_part"), f"Reset sale {tid}")
    return {"ok": True}


@api.post("/vehicles/{vid}/recovery-complete")
async def recovery_complete(vid: str, user: dict = Depends(require("vehicles.edit"))):
    v = await sdb.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    if v.get("status") != "dismantled":
        raise HTTPException(status_code=400, detail="Only dismantled vehicles can be marked recovery-completed")
    await sdb.vehicles.update_one({"id": vid}, {"$set": {"recovery_status": "completed",
                                 "recovery_completed_date": now_iso()[:10]}})
    await audit(user, "update", "vehicle", f"Recovery completed / all parts sold for {v.get('chassis_number','')}")
    return {"ok": True}


@api.get("/recovery/vehicles")
async def recovery_vehicles(type: Optional[str] = None, q: Optional[str] = None,
                            user: dict = Depends(require("parts.view"))):
    # Parts stays active until All Recovery is completed.
    # Engine and Half Cut are mutually exclusive: selling either removes the
    # vehicle from BOTH Engine and Half Cut active lists.
    query = {"status": "dismantled", "recovery_status": {"$ne": "completed"}}
    if q:
        query["$or"] = [
            {"chassis_number": {"$regex": q, "$options": "i"}},
            {"make": {"$regex": q, "$options": "i"}},
            {"model": {"$regex": q, "$options": "i"}},
            {"vehicle_name": {"$regex": q, "$options": "i"}},
            {"engine_number": {"$regex": q, "$options": "i"}},
        ]
    vs = await sdb.vehicles.find(query, {"_id": 0}).sort("dismantle_date", -1).to_list(2000)
    out = []
    for v in vs:
        if type in ("engine", "half_cut"):
            sold_engine_or_halfcut = await sdb.part_sales.find_one({
                "source_vehicle_id": v["id"],
                "category": {"$in": ["engine", "half_cut"]},
            }, {"_id": 0, "id": 1})
            if sold_engine_or_halfcut:
                continue

        rec = await compute_recovery(v)
        out.append({"id": v["id"], "vehicle_name": v.get("vehicle_name") or f"{v.get('make','')} {v.get('model','')}".strip(),
                    "chassis_number": v.get("chassis_number", ""), "dismantle_date": v.get("dismantle_date"),
                    "purchase_price": rec["purchase_price"], "total_recovered": rec["total_recovered"],
                    "remaining_to_recover": rec["remaining_to_recover"], "profit_loss": rec["profit_loss"],
                    "recovery_status": v.get("recovery_status", "open")})
    return out


@api.get("/part-sales")
async def list_part_sales(vehicle_id: Optional[str] = None, user: dict = Depends(require("parts.view"))):
    query = {"source_vehicle_id": vehicle_id} if vehicle_id else {}
    rows = await sdb.part_sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    cmap = {c["id"]: c["name"] for c in await sdb.customers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)}
    for r in rows:
        r["customer_name"] = cmap.get(r.get("customer_id"), "")
    return rows


@api.post("/part-sales")
async def create_part_sale(body: PartSaleIn, user: dict = Depends(get_current_user)):
    if not ("parts.edit" in user["permissions"] or "finance.edit" in user["permissions"]):
        raise HTTPException(status_code=403, detail="Permission denied")
    v = await sdb.vehicles.find_one({"id": body.source_vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Source vehicle not found")
    if v.get("status") != "dismantled":
        raise HTTPException(status_code=400, detail="Parts can only be sold from a dismantled vehicle")
    if body.sale_price < 0 or body.amount_received < 0:
        raise HTTPException(status_code=400, detail="Amounts cannot be negative")
    if body.amount_received > body.sale_price:
        raise HTTPException(status_code=400, detail="Amount received cannot exceed sale price")
    category = body.category if body.category in ("engine", "half_cut", "parts") else "parts"
    d = body.date or now_iso()[:10]
    bal = round(body.sale_price - body.amount_received, 2)
    doc = {"id": new_id(), "source_vehicle_id": body.source_vehicle_id, "category": category,
           "chassis_number": v.get("chassis_number", ""),
           "vehicle_name": v.get("vehicle_name") or f"{v.get('make','')} {v.get('model','')}".strip(),
           "date": d, "part_name": body.part_name, "customer_id": body.customer_id,
           "sale_price": body.sale_price, "amount_received": body.amount_received,
           "balance_due": bal, "created_at": now_iso()}
    await sdb.part_sales.insert_one(doc)
    await fund_upsert("vehicle_part_sale", doc["id"], "in", body.amount_received, body.method,
                      d, "parts_sale", f"{category} sale from {v.get('chassis_number','')}")
    doc.pop("_id", None)
    await audit(user, "sell", category,
                f"{category} recovery sale '{body.part_name}' from {v.get('chassis_number','')} for {body.sale_price} (recv {body.amount_received})")
    return doc


@api.delete("/part-sales/{sid}")
async def del_part_sale(sid: str, user: dict = Depends(require("records.reverse"))):
    s = await sdb.part_sales.find_one({"id": sid})
    await sdb.part_sales.delete_one({"id": sid})
    await fund_remove("vehicle_part_sale", sid)
    if s:
        await audit(user, "reverse", "part", f"Reversed parts sale '{s.get('part_name','')}' from {s.get('chassis_number','')}")
    return {"ok": True}



@api.get("/scrap-allocations")
async def list_scrap(user: dict = Depends(require("finance.view"))):
    return await sdb.scrap_allocations.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api.post("/scrap-allocations")
async def create_scrap(body: ScrapIn, user: dict = Depends(require("finance.edit"))):
    if await sdb.scrap_allocations.find_one({"month": body.month}):
        raise HTTPException(status_code=400, detail="Scrap already allocated for this month")
    start, end = body.month + "-01", body.month + "-31"
    vehicles = await sdb.vehicles.find({"status": "dismantled",
        "dismantle_date": {"$gte": start, "$lte": end + "T23:59:59"}},
        {"_id": 0, "id": 1, "scrap_amount": 1}).to_list(10000)
    ids = [v["id"] for v in vehicles]
    if not ids:
        raise HTTPException(status_code=400, detail="No eligible dismantled vehicles in that month")
    fixed = {v["id"]: round(float(v.get("scrap_amount")), 2) for v in vehicles if v.get("scrap_amount") is not None}
    fixed_total = round(sum(fixed.values()), 2)
    if fixed_total > body.total_amount:
        raise HTTPException(status_code=400, detail="Fixed vehicle scrap amounts exceed total scrap amount")
    normal_ids = [v["id"] for v in vehicles if v.get("scrap_amount") is None]
    remaining = round(body.total_amount - fixed_total, 2)
    if not normal_ids and abs(remaining) > 0.01:
        raise HTTPException(status_code=400, detail="Total scrap must equal fixed scrap amounts when no normal vehicles remain")
    per = round(remaining / len(normal_ids), 2) if normal_ids else 0
    vehicle_amounts = {**fixed, **{vid: per for vid in normal_ids}}
    # Put rounding remainder on the last normal vehicle so allocations equal the entered total exactly.
    if normal_ids:
        allocated = round(sum(vehicle_amounts.values()), 2)
        vehicle_amounts[normal_ids[-1]] = round(vehicle_amounts[normal_ids[-1]] + body.total_amount - allocated, 2)
    doc = {"id": new_id(), "month": body.month, "date": body.date or (body.month + "-15"),
           "total_amount": body.total_amount, "vehicle_ids": ids, "per_vehicle": per,
           "vehicle_amounts": vehicle_amounts, "fixed_total": fixed_total,
           "vehicle_count": len(ids), "created_at": now_iso()}
    await sdb.scrap_allocations.insert_one(doc)
    doc.pop("_id", None)
    await audit(user, "create", "scrap_allocation",
                f"Scrap {body.month} total {body.total_amount} over {len(ids)} vehicles = {per} each")
    return doc


@api.delete("/scrap-allocations/{aid}")
async def del_scrap(aid: str, user: dict = Depends(require("records.reverse"))):
    a = await sdb.scrap_allocations.find_one({"id": aid})
    await sdb.scrap_allocations.delete_one({"id": aid})
    if a:
        await audit(user, "reverse", "scrap_allocation", f"Reversed scrap allocation {a['month']}")
    return {"ok": True}


@api.get("/shokubai-allocations")
async def list_shok(user: dict = Depends(require("finance.view"))):
    return await sdb.shokubai_allocations.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api.post("/shokubai-allocations")
async def create_shok(body: ShokubaiIn, user: dict = Depends(require("finance.edit"))):
    prev = await sdb.shokubai_allocations.find_one(sort=[("new_cutoff", -1)])
    prev_cutoff = prev["new_cutoff"] if prev else "2000-01-01"
    if body.sale_date <= prev_cutoff:
        raise HTTPException(status_code=400, detail=f"Cut-off must be after previous cut-off {prev_cutoff}")
    already = set()
    async for a in sdb.shokubai_allocations.find({}, {"_id": 0, "vehicle_ids": 1}):
        already.update(a["vehicle_ids"])
    vehicles = await sdb.vehicles.find({"status": "dismantled", "shokubai_with_engine": {"$ne": True},
        "dismantle_date": {"$gt": prev_cutoff, "$lte": body.sale_date + "T23:59:59"}}, {"_id": 0, "id": 1}).to_list(10000)
    ids = [v["id"] for v in vehicles if v["id"] not in already]
    if not ids:
        raise HTTPException(status_code=400, detail="No eligible dismantled vehicles for this period")
    per = round(body.total_amount / len(ids), 2)
    doc = {"id": new_id(), "prev_cutoff": prev_cutoff, "new_cutoff": body.sale_date,
           "sale_date": body.sale_date, "total_amount": body.total_amount, "vehicle_ids": ids,
           "per_vehicle": per, "vehicle_count": len(ids), "created_at": now_iso()}
    await sdb.shokubai_allocations.insert_one(doc)
    doc.pop("_id", None)
    await audit(user, "create", "shokubai_allocation",
                f"Shokubai {prev_cutoff} → {body.sale_date} total {body.total_amount} over {len(ids)} = {per} each")
    return doc


@api.delete("/shokubai-allocations/{aid}")
async def del_shok(aid: str, user: dict = Depends(require("records.reverse"))):
    a = await sdb.shokubai_allocations.find_one({"id": aid})
    await sdb.shokubai_allocations.delete_one({"id": aid})
    if a:
        await audit(user, "reverse", "shokubai_allocation", f"Reversed shokubai {a['prev_cutoff']} → {a['new_cutoff']}")
    return {"ok": True}


# ---- Small Sales (miscellaneous revenue; full amount is profit/revenue, no separate COGS) ----
@api.get("/small-sales")
async def list_small_sales(user: dict = Depends(require("finance.view"))):
    return await sdb.small_sales.find({}, {"_id": 0}).sort("date", -1).to_list(5000)


@api.post("/small-sales")
async def create_small_sale(body: SmallSaleIn, user: dict = Depends(require("finance.edit"))):
    if not body.item_name.strip():
        raise HTTPException(status_code=400, detail="Item name is required")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    if not _valid_money_method(body.method):
        raise HTTPException(status_code=400, detail="Payment method must be cash or bank")
    sid = new_id()
    sale_date = body.date or now_iso()[:10]
    doc = {"id": sid, "date": sale_date, "item_name": body.item_name.strip(),
           "sold_to": (body.sold_to or "").strip(), "amount": round(float(body.amount), 2),
           "method": body.method, "note": (body.note or "").strip(), "created_at": now_iso()}
    await sdb.small_sales.insert_one(doc)
    await fund_upsert("small_sale", sid, "in", doc["amount"], doc["method"], doc["date"],
                      "small_sale", f"Small sale {doc['item_name']}" + (f" to {doc['sold_to']}" if doc["sold_to"] else ""))
    await audit(user, "create", "small_sale", f"Small sale {doc['item_name']} for {doc['amount']}")
    doc.pop("_id", None)
    return doc


@api.put("/small-sales/{sid}")
async def update_small_sale(sid: str, body: SmallSaleIn, user: dict = Depends(require("finance.edit"))):
    old = await sdb.small_sales.find_one({"id": sid}, {"_id": 0})
    if not old:
        raise HTTPException(status_code=404, detail="Small sale not found")
    if not body.item_name.strip():
        raise HTTPException(status_code=400, detail="Item name is required")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    if not _valid_money_method(body.method):
        raise HTTPException(status_code=400, detail="Payment method must be cash or bank")
    doc = {"date": body.date or old.get("date") or now_iso()[:10],
           "item_name": body.item_name.strip(), "sold_to": (body.sold_to or "").strip(),
           "amount": round(float(body.amount), 2), "method": body.method,
           "note": (body.note or "").strip(), "updated_at": now_iso()}
    await sdb.small_sales.update_one({"id": sid}, {"$set": doc})
    # Idempotent upsert replaces the old Cash/Bank movement, including method/amount/date changes.
    await fund_upsert("small_sale", sid, "in", doc["amount"], doc["method"], doc["date"],
                      "small_sale", f"Small sale {doc['item_name']}" + (f" to {doc['sold_to']}" if doc["sold_to"] else ""))
    await audit(user, "update", "small_sale", f"Updated small sale {sid} from {old.get('amount', 0)} to {doc['amount']}")
    return {"ok": True}


@api.delete("/small-sales/{sid}")
async def delete_small_sale(sid: str, user: dict = Depends(require("records.reverse"))):
    sale = await sdb.small_sales.find_one({"id": sid}, {"_id": 0})
    if not sale:
        raise HTTPException(status_code=404, detail="Small sale not found")
    await sdb.small_sales.delete_one({"id": sid})
    await fund_remove("small_sale", sid)
    await audit(user, "reverse", "small_sale", f"Deleted small sale {sale.get('item_name','')} for {sale.get('amount',0)}")
    return {"ok": True}


async def summarize(start, end):
    hi = end + "T23:59:59"
    def rng(f):
        return {f: {"$gte": start, "$lte": hi}}
    pv = await sdb.vehicles.find({"purchase_date": {"$gte": start, "$lte": hi}}, {"_id": 0, "purchase_price": 1}).to_list(20000)
    complete = await sdb.vehicles.find({"status": {"$in": ["sold", "sold_complete"]}, "sale_date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(20000)
    complete_sales = sum(v.get("sale_price", 0) for v in complete)
    complete_recv = sum(v.get("amount_received", 0) for v in complete)
    # Invoice-linked Engine/H-C sales are already included in invoice totals below.
    # Only legacy/direct tracked sales should be added separately here.
    tracked = await sdb.tracked_parts.find({"status": "sold", "invoice_id": {"$in": [None, ""]},
        "sale_date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(20000)
    engine_sales = sum(t["sale_price"] for t in tracked if t["part_type"] == "engine")
    halfcut_sales = sum(t["sale_price"] for t in tracked if t["part_type"] == "half_cut")
    tracked_recv = sum(t["amount_received"] for t in tracked)
    invoices = await sdb.invoices.find({"created_at": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(20000)
    # Invoice line prices are tax-inclusive.  Categorize each line by its real item type
    # so complete vehicles do not appear under Spare Parts.  Complete-vehicle revenue
    # itself is read from the vehicle record above, which also covers direct vehicle sales.
    invoice_parts_sales = 0.0
    invoice_engine_sales = 0.0
    invoice_halfcut_sales = 0.0
    for inv in invoices:
        for it in inv.get("items", []):
            line_total = float(it.get("quantity", 1) or 0) * float(it.get("unit_price", 0) or 0)
            item_type = it.get("item_type", "custom")
            if item_type == "engine":
                invoice_engine_sales += line_total
            elif item_type == "half_cut":
                invoice_halfcut_sales += line_total
            elif item_type == "vehicle":
                # Already counted in complete_sales from the linked vehicle record.
                pass
            else:
                # Spare-parts and custom invoice lines remain in the Parts bucket.
                invoice_parts_sales += line_total
    included_tax = round(sum(i.get("tax", 0) for i in invoices), 2)
    invoice_recv = sum(i.get("amount_paid", 0) for i in invoices)
    vpart_rows = await sdb.part_sales.find({"date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(20000)
    vpart_engine = sum(p.get("sale_price", 0) for p in vpart_rows if p.get("category") == "engine")
    vpart_hcut = sum(p.get("sale_price", 0) for p in vpart_rows if p.get("category") == "half_cut")
    vpart_parts = sum(p.get("sale_price", 0) for p in vpart_rows if p.get("category", "parts") == "parts")
    vpart_recv = sum(p.get("amount_received", 0) for p in vpart_rows)
    engine_sales += invoice_engine_sales + vpart_engine
    halfcut_sales += invoice_halfcut_sales + vpart_hcut
    parts_sales = invoice_parts_sales + vpart_parts
    scrap_sales = sum(a["total_amount"] for a in await sdb.scrap_allocations.find({"date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(2000))
    shok_sales = sum(a["total_amount"] for a in await sdb.shokubai_allocations.find({"sale_date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(2000))
    small_sales = sum(a.get("amount", 0) for a in await sdb.small_sales.find({"date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(5000))
    other_sales = scrap_sales + shok_sales + small_sales
    total_sales = complete_sales + engine_sales + halfcut_sales + parts_sales + other_sales
    received = complete_recv + tracked_recv + invoice_recv + vpart_recv + other_sales
    exps = await sdb.expenses.find(rng("date"), {"_id": 0}).to_list(20000)
    by = {}
    for e in exps:
        by[e["category"]] = round(by.get(e["category"], 0) + e["amount"], 2)
    salaries = sum(s["amount"] for s in await sdb.salaries.find({"date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(5000))
    total_expenses = sum(by.values()) + salaries
    direct = await sdb.tracked_parts.find({"source": "direct", "date": {"$gte": start, "$lte": hi}}, {"_id": 0, "purchase_price": 1}).to_list(20000)
    standalone_purchases = round(sum(t.get("purchase_price", 0) for t in direct), 2)
    period_parts = await sdb.parts.find({"$or": [
        {"purchase_date": {"$gte": start, "$lte": hi}},
        {"purchase_date": None, "created_at": {"$gte": start, "$lte": hi}}]}, {"_id": 0, "unit_cost": 1, "quantity": 1, "purchased_quantity": 1}).to_list(20000)
    # Purchases use the ORIGINAL purchased quantity so history never shrinks when stock is sold.
    parts_purchases = round(sum(p.get("unit_cost", 0) * p.get("purchased_quantity", p.get("quantity", 0)) for p in period_parts), 2)
    vehicle_purchases = round(sum(v.get("purchase_price", 0) for v in pv), 2)
    total_purchases = round(vehicle_purchases + standalone_purchases + parts_purchases, 2)
    opening_stock = await stock_value_asof(_prev_day(start))
    closing_stock = await stock_value_asof(end)
    cogs = round(opening_stock + total_purchases - closing_stock, 2)
    net_profit = round(total_sales - cogs - total_expenses, 2)
    return {"vehicles_purchased": len(pv), "purchase_total": vehicle_purchases,
            "vehicle_purchases": vehicle_purchases, "standalone_purchases": standalone_purchases,
            "parts_purchases": parts_purchases, "total_purchases": total_purchases,
            "complete_sales": round(complete_sales, 2), "engine_sales": round(engine_sales, 2),
            "halfcut_sales": round(halfcut_sales, 2), "parts_sales": round(parts_sales, 2),
            "scrap_sales": round(scrap_sales, 2), "shokubai_sales": round(shok_sales, 2),
            "small_sales": round(small_sales, 2), "other_sales": round(other_sales, 2),
            "total_sales": round(total_sales, 2), "received": round(received, 2),
            "balance_due": round(total_sales - received, 2), "salaries": round(salaries, 2),
            "expenses_by_category": by, "total_expenses": round(total_expenses, 2),
            "engine_halfcut_purchases": standalone_purchases,
            "opening_stock": round(opening_stock, 2), "closing_stock": round(closing_stock, 2),
            "cogs": cogs,
            "cost_of_sold_items": cogs,
            "remaining_stock": round(closing_stock, 2),
            "sales_profit_loss": round(total_sales - cogs, 2),
            "net_profit": net_profit}


async def report_detail(start, end):
    hi = end + "T23:59:59"
    cmap = {c["id"]: c["name"] for c in await sdb.customers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)}
    def vname(v):
        return v.get("vehicle_name") or f"{v.get('make','')} {v.get('model','')}".strip() or "—"
    purchases = await sdb.vehicles.find({"purchase_date": {"$gte": start, "$lte": hi}}, {"_id": 0}).sort("purchase_date", 1).to_list(20000)
    parts = await sdb.parts.find({"$or": [
        {"purchase_date": {"$gte": start, "$lte": hi}},
        {"purchase_date": None, "created_at": {"$gte": start, "$lte": hi}}]}, {"_id": 0}).to_list(20000)
    direct = await sdb.tracked_parts.find({"source": "direct", "date": {"$gte": start, "$lte": hi}}, {"_id": 0}).sort("date", 1).to_list(20000)
    complete = await sdb.vehicles.find({"status": {"$in": ["sold", "sold_complete"]}, "sale_date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(20000)
    tracked_sold = await sdb.tracked_parts.find({"status": "sold", "sale_date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(20000)
    scrap = await sdb.scrap_allocations.find({"date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(2000)
    shok = await sdb.shokubai_allocations.find({"sale_date": {"$gte": start, "$lte": hi}}, {"_id": 0}).to_list(2000)
    vpart = await sdb.part_sales.find({"date": {"$gte": start, "$lte": hi}}, {"_id": 0}).sort("date", 1).to_list(20000)
    ttype = lambda t: "Engine" if t.get("part_type") == "engine" else "Half Cut"
    return {
        "vehicle_purchases": [[(v.get("purchase_date") or "")[:10], vname(v), v.get("chassis_number", ""), v.get("supplier", ""), v.get("purchase_price", 0)] for v in purchases],
        "parts": [[(p.get("purchase_date") or p.get("created_at") or "")[:10], p.get("name", ""), p.get("quantity", 0), p.get("unit_cost", 0), p.get("sale_price", 0), p.get("supplier", "")] for p in parts],
        "direct_purchases": [[(d.get("date") or "")[:10], ttype(d), d.get("name", ""), d.get("supplier", ""), d.get("purchase_price", 0)] for d in direct],
        "complete_sales": [[(v.get("sale_date") or "")[:10], vname(v), v.get("chassis_number", ""), cmap.get(v.get("customer_id"), ""), v.get("sale_price", 0)] for v in complete],
        "tracked_sales": [[(t.get("sale_date") or "")[:10], ttype(t), t.get("name") or t.get("engine_code") or t.get("vehicle_name", ""), cmap.get(t.get("customer_id"), ""), t.get("sale_price", 0)] for t in tracked_sold],
        "part_sales": [[(p.get("date") or "")[:10], {"engine": "Engine", "half_cut": "Half Cut"}.get(p.get("category"), "Parts"), p.get("vehicle_name", ""), p.get("chassis_number", ""), p.get("part_name", ""), cmap.get(p.get("customer_id"), ""), p.get("sale_price", 0)] for p in vpart],
        "scrap": [[a.get("month", ""), (a.get("date") or "")[:10], a.get("total_amount", 0), a.get("vehicle_count", 0), a.get("per_vehicle", 0)] for a in scrap],
        "shokubai": [[f"{a.get('prev_cutoff','')} \u2192 {a.get('new_cutoff','')}", a.get("total_amount", 0), a.get("vehicle_count", 0), a.get("per_vehicle", 0)] for a in shok],
    }


@api.get("/reports/monthly")
async def monthly(month: str, user: dict = Depends(require("reports.view"))):
    return await summarize(month + "-01", month + "-31")


@api.get("/reports/yearly")
async def yearly(year: str, month: Optional[str] = None, user: dict = Depends(require("reports.view"))):
    if month and month != "all":
        return await summarize(f"{year}-{month}-01", f"{year}-{month}-31")
    return await summarize(f"{year}-01-01", f"{year}-12-31")


@api.get("/reports/today/pdf")
async def today_pdf(request: Request):
    await auth_or_token(request)
    day = now_iso()[:10]
    data = await summarize(day, day)
    detail = await report_detail(day, day)
    settings = await sdb.settings.find_one({"id": settings_id()}, {"_id": 0}) or CompanySettings().model_dump()
    pdf = build_summary_pdf(f"Daily Report — {day}", data, detail, settings)
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{current_company.get()}-today-{day}.pdf"'})


@api.get("/reports/monthly/pdf")
async def monthly_pdf(month: str, request: Request):
    await auth_or_token(request)
    data = await summarize(month + "-01", month + "-31")
    detail = await report_detail(month + "-01", month + "-31")
    settings = await sdb.settings.find_one({"id": settings_id()}, {"_id": 0}) or CompanySettings().model_dump()
    pdf = build_summary_pdf(f"Monthly Report — {month}", data, detail, settings)
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{current_company.get()}-monthly-{month}.pdf"'})


@api.get("/reports/yearly/pdf")
async def yearly_pdf(year: str, request: Request, month: Optional[str] = None):
    await auth_or_token(request)
    if month and month != "all":
        start, end = f"{year}-{month}-01", f"{year}-{month}-31"
        label = f"Yearly Report — {year}-{month}"
        fname = f"{current_company.get()}-yearly-{year}-{month}.pdf"
    else:
        start, end = f"{year}-01-01", f"{year}-12-31"
        label = f"Yearly Report — {year}"
        fname = f"{current_company.get()}-yearly-{year}.pdf"
    data = await summarize(start, end)
    detail = await report_detail(start, end)
    settings = await sdb.settings.find_one({"id": settings_id()}, {"_id": 0}) or CompanySettings().model_dump()
    pdf = build_summary_pdf(label, data, detail, settings)
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------- PDF builders ----------------
def _logo_from_settings(settings, width=45 * mm):
    src = None
    url = (settings or {}).get("logo_url", "") or ""
    if isinstance(url, str) and url.startswith("data:image"):
        try:
            import tempfile
            raw = base64.b64decode(url.split(",", 1)[1])
            tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            tmp.write(raw)
            tmp.flush()
            tmp.close()
            src = tmp.name
        except Exception:
            src = None
    if src is None and LOGO_PATH.exists():
        src = str(LOGO_PATH)
    if src is None:
        return None
    try:
        img = RLImage(src)
        ratio = img.imageHeight / img.imageWidth
        img.drawWidth = width
        img.drawHeight = width * ratio
        return img
    except Exception:
        return None


def _logo_flowable(width=45 * mm):
    if LOGO_PATH.exists():
        try:
            img = RLImage(str(LOGO_PATH))
            ratio = img.imageHeight / img.imageWidth
            img.drawWidth = width
            img.drawHeight = width * ratio
            return img
        except Exception:
            return None
    return None


def build_invoice_pdf(inv, settings, customer) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=15 * mm, bottomMargin=15 * mm,
                            leftMargin=15 * mm, rightMargin=15 * mm)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("t", parent=styles["Title"], textColor=DARK, fontSize=22)
    small = ParagraphStyle("s", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#444444"))
    sym = settings.get("currency_symbol", "¥")
    el = []
    logo = _logo_from_settings(settings)
    header_left = logo if logo else Paragraph(settings["name"], title)
    company_info = Paragraph(
        f"<b>{settings['name']}</b><br/>{settings['address']}<br/>Tel: {settings['phone']}<br/>{settings['email']}", small)
    header = Table([[header_left, company_info]], colWidths=[55 * mm, 110 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    el.append(header)
    el.append(Spacer(1, 8 * mm))
    el.append(Paragraph(f"<b>INVOICE {inv['invoice_number']}</b>", ParagraphStyle(
        "inv", parent=styles["Normal"], fontSize=14, textColor=DARK)))
    el.append(Spacer(1, 2 * mm))
    el.append(Paragraph(f"Date: {inv['created_at'][:10]}", small))
    el.append(Paragraph(f"Bill To: <b>{customer.get('name','—')}</b>  {customer.get('phone','')}  {customer.get('address','')}", small))
    el.append(Spacer(1, 6 * mm))
    data = [["Description", "Qty", "Unit Price", "Amount"]]
    for it in inv["items"]:
        amt = it["quantity"] * it["unit_price"]
        data.append([it["description"], str(it["quantity"]),
                     f"{sym}{it['unit_price']:,.0f}", f"{sym}{amt:,.0f}"])
    data.append(["", "", "Subtotal", f"{sym}{inv['subtotal']:,.0f}"])
    data.append(["", "", f"Tax ({inv['tax_rate']}%)", f"{sym}{inv['tax']:,.0f}"])
    data.append(["", "", "Total", f"{sym}{inv['total']:,.0f}"])
    data.append(["", "", "Paid", f"{sym}{inv.get('amount_paid',0):,.0f}"])
    data.append(["", "", "Balance", f"{sym}{(inv['total']-inv.get('amount_paid',0)):,.0f}"])
    t = Table(data, colWidths=[85 * mm, 20 * mm, 35 * mm, 35 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), GOLD),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 1, DARK),
        ("LINEBELOW", (0, 1), (-1, -6), 0.4, colors.HexColor("#DDDDDD")),
        ("FONTNAME", (2, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, -3), (-1, -3), "Helvetica-Bold"),
        ("TEXTCOLOR", (2, -3), (-1, -3), colors.HexColor("#8a6d1b")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    el.append(t)
    if inv.get("notes"):
        el.append(Spacer(1, 6 * mm))
        el.append(Paragraph(f"Notes: {inv['notes']}", small))
    if settings.get("bank_details"):
        el.append(Spacer(1, 6 * mm))
        el.append(Paragraph("<b>Bank Details</b><br/>" + settings["bank_details"].replace("\n", "<br/>"), small))
    el.append(Spacer(1, 12 * mm))
    el.append(Paragraph(settings.get("invoice_footer") or "Thank you for your business.", small))
    doc.build(el)
    return buf.getvalue()


def build_report_pdf(pnl, stock, settings) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=15 * mm, bottomMargin=15 * mm,
                            leftMargin=15 * mm, rightMargin=15 * mm)
    styles = getSampleStyleSheet()
    sym = settings.get("currency_symbol", "¥")
    el = []
    logo = _logo_from_settings(settings, 40 * mm)
    if logo:
        el.append(logo)
    el.append(Paragraph(f"<b>{settings['name']}</b>", ParagraphStyle("c", parent=styles["Title"], fontSize=16, textColor=DARK)))
    el.append(Paragraph(f"Financial Report — Generated {now_iso()[:10]}", ParagraphStyle("d", parent=styles["Normal"], fontSize=9)))
    el.append(Spacer(1, 8 * mm))
    el.append(Paragraph("<b>Profit &amp; Loss</b>", styles["Heading2"]))
    pnl_rows = [["Item", "Amount"],
                ["Sales Revenue", f"{sym}{pnl['sales_revenue']:,.0f}"],
                ["Cost of Goods Sold", f"{sym}{pnl['cogs']:,.0f}"],
                ["Gross Profit", f"{sym}{pnl['gross_profit']:,.0f}"],
                ["Expenses", f"{sym}{pnl['expenses']:,.0f}"],
                ["Salaries", f"{sym}{pnl['salaries']:,.0f}"],
                ["Net Profit", f"{sym}{pnl['net_profit']:,.0f}"],
                ["Tax Collected", f"{sym}{pnl['tax_collected']:,.0f}"]]
    t = Table(pnl_rows, colWidths=[100 * mm, 65 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK), ("TEXTCOLOR", (0, 0), (-1, 0), GOLD),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("FONTNAME", (0, -2), (-1, -2), "Helvetica-Bold"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    el.append(t)
    el.append(Spacer(1, 8 * mm))
    el.append(Paragraph("<b>Stock Valuation</b>", styles["Heading2"]))
    stock_rows = [["Item", "Count", "Value"],
                  ["Vehicles in stock", str(stock["vehicles_count"]), f"{sym}{stock['vehicles_value']:,.0f}"],
                  ["Spare parts", str(stock["parts_count"]), f"{sym}{stock['parts_value']:,.0f}"],
                  ["Total Inventory", "", f"{sym}{stock['total_value']:,.0f}"]]
    t2 = Table(stock_rows, colWidths=[85 * mm, 40 * mm, 40 * mm])
    t2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK), ("TEXTCOLOR", (0, 0), (-1, 0), GOLD),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, colors.HexColor("#DDDDDD")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    el.append(t2)
    doc.build(el)
    return buf.getvalue()


def build_summary_pdf(title, summary, detail, settings) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), topMargin=12 * mm, bottomMargin=12 * mm,
                            leftMargin=12 * mm, rightMargin=12 * mm)
    styles = getSampleStyleSheet()
    sym = settings.get("currency_symbol", "¥")
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=11, textColor=DARK, spaceBefore=7, spaceAfter=3)
    el = []

    def money(x):
        try:
            return f"{sym}{float(x):,.0f}"
        except Exception:
            return str(x)

    logo = _logo_from_settings(settings, 26 * mm)
    head_left = logo if logo else Paragraph(f"<b>{settings['name']}</b>", ParagraphStyle("c", parent=styles["Title"], fontSize=14, textColor=DARK))
    head_right = Paragraph(f"<b>{settings['name']}</b><br/>{title}<br/>Generated {now_iso()[:10]}",
                           ParagraphStyle("hr", parent=styles["Normal"], fontSize=9, alignment=2))
    header = Table([[head_left, head_right]], colWidths=[120 * mm, 153 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    el.append(header)
    el.append(Spacer(1, 3 * mm))

    s = summary
    srow = [["Vehicle Purchases", money(s.get("vehicle_purchases", s.get("purchase_total", 0))), "Complete Sales", money(s.get("complete_sales", 0))],
            ["Standalone Eng/HC Purch.", money(s.get("standalone_purchases", s.get("engine_halfcut_purchases", 0))), "Engine Sales", money(s.get("engine_sales", 0))],
            ["Spare Parts Purchases", money(s.get("parts_purchases", 0)), "Half Cut Sales", money(s.get("halfcut_sales", 0))],
            ["Total Purchases", money(s.get("total_purchases", 0)), "Parts Sales", money(s.get("parts_sales", 0))],
            ["Opening Stock", money(s.get("opening_stock", 0)), "Scrap Sales", money(s.get("scrap_sales", 0))],
            ["Closing Stock", money(s.get("closing_stock", 0)), "Shokubai Sales", money(s.get("shokubai_sales", 0))],
            ["COGS", money(s.get("cogs", 0)), "Total Sales", money(s.get("total_sales", 0))],
            ["Expenses", money(s.get("total_expenses", 0)), "Amount Received", money(s.get("received", 0))],
            ["Salaries", money(s.get("salaries", 0)), "Balance Due", money(s.get("balance_due", 0))],
            ["Net Profit / Loss", money(s.get("net_profit", 0)), "", ""]]
    st = Table(srow, colWidths=[55 * mm, 40 * mm, 55 * mm, 40 * mm])
    st.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3EAD0")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F3EAD0")),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("ALIGN", (3, 0), (3, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#DDDDDD")),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    el.append(Paragraph("<b>Summary</b>", h2))
    el.append(st)

    def section(name, headers, rows, widths, money_cols=()):
        if not rows:
            return
        # Fit within the usable landscape width so nothing clips; scale down if needed.
        usable = 273.0
        total_w = float(sum(widths))
        if total_w > usable:
            widths = [w * usable / total_w for w in widths]
        cell_style = ParagraphStyle("cell", parent=styles["Normal"], fontSize=7.5, leading=9)
        el.append(Paragraph(f"<b>{name}</b> ({len(rows)})", h2))
        data = [headers]
        for r in rows:
            row = []
            for i, c in enumerate(r):
                if i in money_cols:
                    row.append(money(c))
                else:
                    row.append(Paragraph(str(c) if c is not None else "", cell_style))
            data.append(row)
        t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
        style = [
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("BACKGROUND", (0, 0), (-1, 0), DARK), ("TEXTCOLOR", (0, 0), (-1, 0), GOLD),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, DARK),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F7F7")]),
            ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#E5E5E5")),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]
        for mc in money_cols:
            style.append(("ALIGN", (mc, 0), (mc, -1), "RIGHT"))
        t.setStyle(TableStyle(style))
        el.append(t)

    section("Vehicle Purchases", ["Date", "Vehicle Name", "Chassis", "From", "Purchase Amount"],
            detail.get("vehicle_purchases", []), [30, 90, 60, 55, 45], money_cols=(4,))
    section("Spare Parts", ["Date", "Part Name", "Qty", "Unit Cost", "Sale Price", "From"],
            detail.get("parts", []), [28, 80, 18, 42, 42, 60], money_cols=(3, 4))
    section("Direct Engine / Half Cut Purchases", ["Date", "Type", "Name", "From", "Purchase Price"],
            detail.get("direct_purchases", []), [30, 35, 95, 65, 45], money_cols=(4,))
    section("Complete Vehicle Sales", ["Date", "Vehicle Name", "Chassis", "To", "Amount"],
            detail.get("complete_sales", []), [30, 90, 60, 55, 45], money_cols=(4,))
    section("Engine / Half Cut Sales", ["Date", "Type", "Name", "To", "Sale Price"],
            detail.get("tracked_sales", []), [30, 35, 95, 65, 45], money_cols=(4,))
    section("Vehicle Recovery Sales (Engine / Half Cut / Parts)", ["Date", "Type", "Vehicle", "Chassis", "Item", "To", "Sale Price"],
            detail.get("part_sales", []), [24, 30, 60, 50, 55, 50, 44], money_cols=(6,))
    section("Scrap Allocations", ["Month", "Date", "Total", "Vehicles", "Per Vehicle"],
            detail.get("scrap", []), [40, 40, 50, 30, 50], money_cols=(2, 4))
    section("Shokubai Allocations", ["Period", "Total", "Vehicles", "Per Vehicle"],
            detail.get("shokubai", []), [110, 50, 35, 50], money_cols=(1, 3))

    doc.build(el)
    return buf.getvalue()


# ---------------- Startup ----------------
# ---------------- Brokers / Suppliers ----------------
async def broker_account(bid: str) -> dict:
    bvs = await sdb.broker_vehicles.find({"broker_id": bid}, {"_id": 0}).to_list(5000)
    pays = await sdb.broker_payments.find({"broker_id": bid}, {"_id": 0}).to_list(5000)
    total_purchase = round(sum(v.get("purchase_price", 0) for v in bvs), 2)
    total_paid = round(sum(v.get("paid_amount", 0) for v in bvs) + sum(p.get("amount", 0) for p in pays), 2)
    pending = sum(1 for v in bvs if v.get("status") == "pending")
    received = sum(1 for v in bvs if v.get("status") == "received")
    return {"total_purchase": total_purchase, "total_paid": total_paid,
            "payment_due": round(max(total_purchase - total_paid, 0), 2),
            "advance": round(max(total_paid - total_purchase, 0), 2),
            "vehicles_count": len(bvs), "pending_count": pending, "received_count": received}


@api.get("/brokers")
async def list_brokers(user: dict = Depends(require("finance.view"))):
    out = []
    for b in await sdb.brokers.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000):
        b["account"] = await broker_account(b["id"])
        out.append(b)
    return out


@api.post("/brokers")
async def create_broker(body: BrokerIn, user: dict = Depends(require("finance.edit"))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await sdb.brokers.insert_one(doc)
    await audit(user, "create", "broker", f"Added broker {body.name}")
    doc.pop("_id", None)
    return doc


@api.get("/brokers/{bid}")
async def get_broker(bid: str, user: dict = Depends(require("finance.view"))):
    b = await sdb.brokers.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Broker not found")
    b["vehicles"] = await sdb.broker_vehicles.find({"broker_id": bid}, {"_id": 0}).sort("purchase_date", -1).to_list(5000)
    b["payments"] = await sdb.broker_payments.find({"broker_id": bid}, {"_id": 0}).sort("date", -1).to_list(5000)
    b["account"] = await broker_account(bid)
    return b


@api.put("/brokers/{bid}")
async def update_broker(bid: str, body: BrokerIn, user: dict = Depends(require("finance.edit"))):
    await sdb.brokers.update_one({"id": bid}, {"$set": body.model_dump(exclude_unset=True)})
    return {"ok": True}


@api.delete("/brokers/{bid}")
async def delete_broker(bid: str, user: dict = Depends(require("finance.edit"))):
    bvs = await sdb.broker_vehicles.find({"broker_id": bid}, {"_id": 0, "id": 1}).to_list(5000)
    bps = await sdb.broker_payments.find({"broker_id": bid}, {"_id": 0, "id": 1}).to_list(5000)
    await sdb.broker_vehicles.delete_many({"broker_id": bid})
    await sdb.broker_payments.delete_many({"broker_id": bid})
    for x in bvs:
        await fund_remove("broker_vehicle_initial_payment", x["id"])
    for x in bps:
        await fund_remove("broker_payment", x["id"])
    await sdb.brokers.delete_one({"id": bid})
    await audit(user, "delete", "broker", f"Deleted broker {bid}")
    return {"ok": True}


@api.post("/brokers/{bid}/vehicles")
async def add_broker_vehicle(bid: str, body: BrokerVehicleIn, user: dict = Depends(require("finance.edit"))):
    if not await sdb.brokers.find_one({"id": bid}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Broker not found")
    doc = body.model_dump()
    doc.update({"id": new_id(), "broker_id": bid, "status": "pending",
                "received_date": None, "vehicle_id": None, "created_at": now_iso()})
    await sdb.broker_vehicles.insert_one(doc)
    await fund_upsert("broker_vehicle_initial_payment", doc["id"], "out", body.paid_amount, body.payment_method,
                      body.purchase_date or now_iso()[:10], "broker_payment",
                      f"Initial broker payment for {body.vehicle_name}")
    await audit(user, "create", "broker_vehicle", f"Broker pending vehicle {body.vehicle_name}")
    doc.pop("_id", None)
    return doc


@api.put("/broker-vehicles/{bvid}")
async def update_broker_vehicle(bvid: str, body: BrokerVehicleIn, broker_id: Optional[str] = None,
                                user: dict = Depends(require("finance.edit"))):
    existing = await sdb.broker_vehicles.find_one({"id": bvid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Broker vehicle not found")
    target_broker = broker_id or existing.get("broker_id")
    if not await sdb.brokers.find_one({"id": target_broker}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Target broker not found")
    updates = body.model_dump()
    updates["broker_id"] = target_broker
    await sdb.broker_vehicles.update_one({"id": bvid}, {"$set": updates})
    await fund_upsert("broker_vehicle_initial_payment", bvid, "out", body.paid_amount, body.payment_method,
                      body.purchase_date or existing.get("purchase_date") or now_iso()[:10], "broker_payment",
                      f"Initial broker payment for {body.vehicle_name}")
    await audit(user, "update", "broker_vehicle",
                f"Updated/reassigned broker vehicle {body.vehicle_name} to broker {target_broker}")
    return {"ok": True}


@api.put("/broker-vehicles/{bvid}/receive")
async def receive_broker_vehicle(bvid: str, body: BrokerReceiveIn, user: dict = Depends(require("finance.edit"))):
    bv = await sdb.broker_vehicles.find_one({"id": bvid}, {"_id": 0})
    if not bv:
        raise HTTPException(status_code=404, detail="Broker vehicle not found")
    if bv.get("status") == "received":
        raise HTTPException(status_code=400, detail="Already received")
    await sdb.broker_vehicles.update_one({"id": bvid}, {"$set": {
        "status": "received", "received_date": body.received_date or now_iso()[:10],
        "vehicle_id": body.vehicle_id}})
    await audit(user, "update", "broker_vehicle", f"Received broker vehicle {bv.get('vehicle_name','')}")
    return {"ok": True}


@api.delete("/broker-vehicles/{bvid}")
async def delete_broker_vehicle(bvid: str, user: dict = Depends(require("finance.edit"))):
    await sdb.broker_vehicles.delete_one({"id": bvid})
    await fund_remove("broker_vehicle_initial_payment", bvid)
    return {"ok": True}


@api.get("/broker-vehicles/pending")
async def pending_broker_vehicles(user: dict = Depends(require("vehicles.edit"))):
    bmap = {b["id"]: b["name"] for b in await sdb.brokers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)}
    rows = await sdb.broker_vehicles.find({"status": "pending"}, {"_id": 0}).sort("purchase_date", -1).to_list(5000)
    for r in rows:
        r["broker_name"] = bmap.get(r.get("broker_id"), "")
    return rows


@api.post("/brokers/{bid}/payments")
async def add_broker_payment(bid: str, body: BrokerPaymentIn, user: dict = Depends(require("finance.edit"))):
    if not await sdb.brokers.find_one({"id": bid}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Broker not found")
    doc = body.model_dump()
    doc.update({"id": new_id(), "broker_id": bid, "date": body.date or now_iso()[:10], "created_at": now_iso()})
    await sdb.broker_payments.insert_one(doc)
    await fund_upsert("broker_payment", doc["id"], "out", body.amount, body.method,
                      doc["date"], "broker_payment", "Broker payment")
    await audit(user, "create", "broker_payment", f"Broker payment {body.amount}")
    doc.pop("_id", None)
    return doc


@api.put("/broker-payments/{pid}")
async def correct_broker_payment(pid: str, body: PaymentCorrectionIn, user: dict = Depends(require("finance.edit"))):
    p = await sdb.broker_payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Broker payment not found")
    new = {"amount": round(body.amount, 2), "method": body.method, "date": body.date.isoformat(), "note": body.note or ""}
    await record_payment_revision(user, "broker_payment", "edit", p, {**p, **new})
    await sdb.broker_payments.update_one({"id": pid}, {"$set": new})
    await fund_upsert("broker_payment", pid, "out", new["amount"], new["method"], new["date"], "broker_payment", "Broker payment")
    await audit(user, "update", "broker_payment", f"Corrected broker payment {pid}: {p.get('amount')} -> {new['amount']}")
    return {"ok": True}


@api.delete("/broker-payments/{pid}")
async def delete_broker_payment(pid: str, user: dict = Depends(require("finance.edit"))):
    p = await sdb.broker_payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Broker payment not found")
    await record_payment_revision(user, "broker_payment", "delete", p)
    await sdb.broker_payments.delete_one({"id": pid})
    await fund_remove("broker_payment", pid)
    return {"ok": True}


# ---------------- Loans / Udhaar ----------------
async def loan_balance(lid: str) -> dict:
    es = await sdb.loan_entries.find({"loan_id": lid}, {"_id": 0}).to_list(None)
    borrowed = sum(e["amount"] for e in es if e["entry_type"] == "borrowed")
    repaid = sum(e["amount"] for e in es if e["entry_type"] == "repayment")
    lent = sum(e["amount"] for e in es if e["entry_type"] == "lent")
    received = sum(e["amount"] for e in es if e["entry_type"] == "received_back")
    i_owe = round(borrowed - repaid, 2)
    receivable = round(lent - received, 2)
    return {"received_total": borrowed + received, "paid_total": lent + repaid, "i_owe": max(i_owe, 0), "receivable": max(receivable, 0),
            "net": round(receivable - i_owe, 2)}


@api.get("/loans")
async def list_loans(user: dict = Depends(require("reports.view"))):
    out = []
    for l in await sdb.loans.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000):
        l["balance"] = await loan_balance(l["id"])
        out.append(l)
    return out


@api.post("/loans")
async def create_loan(body: LoanIn, user: dict = Depends(require("reports.view"))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await sdb.loans.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/loans/{lid}")
async def get_loan(lid: str, user: dict = Depends(require("reports.view"))):
    l = await sdb.loans.find_one({"id": lid}, {"_id": 0})
    if not l:
        raise HTTPException(status_code=404, detail="Loan not found")
    l["entries"] = await sdb.loan_entries.find({"loan_id": lid}, {"_id": 0}).sort("date", -1).to_list(10000)
    l["balance"] = await loan_balance(lid)
    return l


@api.delete("/loans/{lid}")
async def delete_loan(lid: str, user: dict = Depends(require("reports.view"))):
    await sdb.loan_entries.delete_many({"loan_id": lid})
    await sdb.loans.delete_one({"id": lid})
    return {"ok": True}


@api.post("/loans/{lid}/entries")
async def add_loan_entry(lid: str, body: LoanEntryIn, user: dict = Depends(require("reports.view"))):
    if body.entry_type not in ("borrowed", "lent", "repayment", "received_back"):
        raise HTTPException(status_code=400, detail="Invalid entry type")
    if not await sdb.loans.find_one({"id": lid}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Loan not found")
    doc = body.model_dump()
    doc.update({"id": new_id(), "loan_id": lid, "date": body.date or now_iso()[:10], "created_at": now_iso()})
    await sdb.loan_entries.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/loan-entries/{eid}")
async def update_loan_entry(eid: str, body: LoanEntryIn, user: dict = Depends(require("reports.view"))):
    if body.entry_type not in ("borrowed", "lent", "repayment", "received_back"):
        raise HTTPException(status_code=400, detail="Invalid entry type")
    existing = await sdb.loan_entries.find_one({"id": eid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Loan entry not found")
    updates = body.model_dump()
    updates["date"] = body.date or existing.get("date") or now_iso()[:10]
    await sdb.loan_entries.update_one({"id": eid}, {"$set": updates})
    await audit(user, "update", "loan_entry", f"Updated loan entry {eid}")
    return {"ok": True}


@api.delete("/loan-entries/{eid}")
async def delete_loan_entry(eid: str, user: dict = Depends(require("reports.view"))):
    existing = await sdb.loan_entries.find_one({"id": eid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Loan entry not found")
    await sdb.loan_entries.delete_one({"id": eid})
    await audit(user, "delete", "loan_entry", f"Deleted loan entry {eid}")
    return {"ok": True}


# ---------------- Cash & Bank / Funds ----------------
@api.get("/funds")
async def get_funds(user: dict = Depends(require("settings.manage"))):
    summary = await funds_summary()
    entries = await sdb.fund_entries.find({"source_type": {"$ne": "loan_entry"}}, {"_id": 0}).sort("date", -1).to_list(5000)
    return {"summary": summary, "entries": entries}


@api.post("/funds/manual")
async def add_manual_fund(body: FundManualIn, user: dict = Depends(require("settings.manage"))):
    if body.direction not in ("in", "out") or body.method not in ("cash", "bank"):
        raise HTTPException(status_code=400, detail="Invalid direction or payment method")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    sid = new_id()
    doc = body.model_dump()
    doc.update({"id": new_id(), "source_type": "manual", "source_id": sid,
                "date": body.date or now_iso()[:10], "created_at": now_iso(),
                "created_by": user["name"]})
    await sdb.fund_entries.insert_one(doc)
    await audit(user, "create", "fund_entry", f"Manual {body.direction} {body.amount} {body.method}")
    doc.pop("_id", None)
    return doc


@api.post("/funds/transfer")
async def transfer_funds(body: FundTransferIn, user: dict = Depends(require("settings.manage"))):
    if body.amount <= 0 or body.from_method not in ("cash", "bank") or body.to_method not in ("cash", "bank") or body.from_method == body.to_method:
        raise HTTPException(status_code=400, detail="Invalid transfer")
    d = body.date or now_iso()[:10]
    gid = new_id()
    base = {"date": d, "category": "transfer", "description": body.note or "Cash/Bank transfer",
            "created_at": now_iso(), "created_by": user["name"], "source_type": "transfer", "source_id": gid}
    await sdb.fund_entries.insert_many([
        {"id": new_id(), **base, "direction": "out", "amount": body.amount, "method": body.from_method},
        {"id": new_id(), **base, "direction": "in", "amount": body.amount, "method": body.to_method},
    ])
    await audit(user, "create", "fund_transfer", f"Transferred {body.amount} {body.from_method}->{body.to_method}")
    return {"ok": True}


@api.delete("/funds/manual/{eid}")
async def delete_manual_fund(eid: str, user: dict = Depends(require("settings.manage"))):
    e = await sdb.fund_entries.find_one({"id": eid}, {"_id": 0})
    if not e or e.get("source_type") != "manual":
        raise HTTPException(status_code=404, detail="Manual fund entry not found")
    await sdb.fund_entries.delete_one({"id": eid})
    await audit(user, "delete", "fund_entry", f"Deleted manual fund entry {eid}")
    return {"ok": True}


# ---------------- Owner tools: Fiscal Year + Backup ----------------
async def build_fiscal_snapshot(fiscal_year_start: int) -> dict:
    customers = []
    balances = await compute_balances_bulk()
    for c in await sdb.customers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(5000):
        b = balances.get(c["id"], {"billed": 0, "paid": 0, "advance": 0, "outstanding": 0})
        if any(float(b.get(k) or 0) for k in ("billed", "paid", "advance", "outstanding")):
            customers.append({"id": c["id"], "name": c["name"], "balance": b})
    brokers = []
    for b in await sdb.brokers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(5000):
        brokers.append({"id": b["id"], "name": b["name"], "account": await broker_account(b["id"])})
    loans = []
    for l in await sdb.loans.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(5000):
        loans.append({"id": l["id"], "name": l["name"], "balance": await loan_balance(l["id"])})
    active_vehicles = await sdb.vehicles.find({"$or": [
        {"status": "in_stock"},
        {"status": "dismantled", "recovery_status": {"$ne": "completed"}},
    ]}, {"_id": 0}).to_list(10000)
    return {
        "company": current_company.get(), "fiscal_year_start": fiscal_year_start,
        "label": _period_label(fiscal_year_start), "snapshot_at": now_iso(),
        "funds": await funds_summary(), "customers": customers,
        "brokers": brokers, "loans": loans, "active_vehicles": active_vehicles,
    }


@api.get("/owner/fiscal-years")
async def owner_fiscal_years(user: dict = Depends(require("settings.manage"))):
    current = _current_fiscal_year_start(current_company.get())
    metas = await sdb.fiscal_years.find({}, {"_id": 0}).to_list(200)
    meta = {int(m["fiscal_year_start"]): m for m in metas if m.get("fiscal_year_start") is not None}
    # Always make the current year and recent previous years selectable, without
    # touching the manual Container & TT / monthly-summary close state.
    years = set(meta.keys())
    years.update(range(current - 5, current + 1))
    snaps = {int(x["fiscal_year_start"]): x for x in await sdb.fiscal_snapshots.find({}, {"_id": 0, "fiscal_year_start": 1, "snapshot_at": 1}).to_list(200)}
    return {"years": [{"fiscal_year_start": y, "label": _period_label(y),
                         "closed": bool(meta.get(y, {}).get("closed")),
                         "closed_at": meta.get(y, {}).get("closed_at"),
                         "snapshot_at": snaps.get(y, {}).get("snapshot_at")}
                        for y in sorted(years, reverse=True)]}


@api.post("/owner/fiscal-years/{fiscal_year_start}/close")
async def owner_close_fiscal_year(fiscal_year_start: int, user: dict = Depends(require("settings.manage"))):
    payload = {"closed": True, "closed_at": now_iso(), "updated_at": now_iso()}
    meta = await sdb.fiscal_years.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0})
    if meta:
        await sdb.fiscal_years.update_one({"fiscal_year_start": fiscal_year_start}, {"$set": payload})
    else:
        await sdb.fiscal_years.insert_one({"id": new_id(), "fiscal_year_start": fiscal_year_start,
                                           "created_at": now_iso(), **payload})
    snap = await build_fiscal_snapshot(fiscal_year_start)
    old = await sdb.fiscal_snapshots.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0})
    if old:
        await sdb.fiscal_snapshots.update_one({"fiscal_year_start": fiscal_year_start}, {"$set": snap})
    else:
        await sdb.fiscal_snapshots.insert_one({"id": new_id(), **snap})
    await audit(user, "close", "fiscal_year", f"Closed fiscal year {_period_label(fiscal_year_start)} with snapshot")
    return {"ok": True}


@api.post("/owner/fiscal-years/{fiscal_year_start}/reopen")
async def owner_reopen_fiscal_year(fiscal_year_start: int, user: dict = Depends(require("settings.manage"))):
    payload = {"closed": False, "closed_at": None, "updated_at": now_iso()}
    meta = await sdb.fiscal_years.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0})
    if meta:
        await sdb.fiscal_years.update_one({"fiscal_year_start": fiscal_year_start}, {"$set": payload})
    else:
        await sdb.fiscal_years.insert_one({"id": new_id(), "fiscal_year_start": fiscal_year_start,
                                           "created_at": now_iso(), **payload})
    await audit(user, "reopen", "fiscal_year", f"Reopened fiscal year {_period_label(fiscal_year_start)}")
    return {"ok": True}


@api.get("/owner/fiscal-years/{fiscal_year_start}/snapshot")
async def owner_fiscal_snapshot(fiscal_year_start: int, user: dict = Depends(require("settings.manage"))):
    snap = await sdb.fiscal_snapshots.find_one({"fiscal_year_start": fiscal_year_start}, {"_id": 0})
    if not snap:
        raise HTTPException(status_code=404, detail="No closed-year snapshot found")
    return snap


def _csv_bytes(rows: list) -> bytes:
    if not rows:
        return b""
    keys = []
    seen = set()
    for r in rows:
        for k in r.keys():
            if k not in seen and k != "_id":
                keys.append(k); seen.add(k)
    sio = io.StringIO()
    w = csv.writer(sio)
    w.writerow(keys)
    for r in rows:
        vals = []
        for k in keys:
            v = r.get(k, "")
            if isinstance(v, (dict, list)):
                v = json.dumps(v, ensure_ascii=False, default=str)
            vals.append(v)
        w.writerow(vals)
    return sio.getvalue().encode("utf-8-sig")


# Read-only PDF companion to the existing ZIP backup. The ZIP/restore format is untouched.
@api.get("/owner/backup.pdf")
async def owner_backup_pdf(user: dict = Depends(require("settings.manage"))):
    return await business_report([current_company.get()])


async def business_report(company_ids):
    from xml.sax.saxutils import escape as xml_escape
    cid = " + ".join(company_ids)
    groups = [
        ("Vehicles", "vehicles"), ("Parts", "parts"), ("Tracked Parts", "tracked_parts"),
        ("Part Sales", "part_sales"), ("Customers", "customers"),
        ("Invoices", "invoices"), ("Customer Payments", "payments"),
        ("Expenses", "expenses"), ("Employees", "employees"), ("Salaries", "salaries"),
        ("Customer Shipping", "customer_shipping"), ("Brokers", "brokers"),
        ("Broker Vehicles", "broker_vehicles"), ("Broker Payments", "broker_payments"),
        ("Loans", "loans"), ("Loan Entries", "loan_entries"),
        ("Scrap Allocations", "scrap_allocations"), ("Shokubai Allocations", "shokubai_allocations"),
        ("Small Sales", "small_sales"), ("Cash and Bank Funds", "fund_entries"),
        ("Monthly Summaries", "monthly_summaries"), ("Monthly Summary Years", "monthly_summary_years"),
        ("Fiscal Years", "fiscal_years"), ("Fiscal Snapshots", "fiscal_snapshots"),
        ("Container Invoices", "container_invoices"), ("Income TT", "income_tt"),
        ("BL Amounts", "bl_amounts"), ("Audit Logs", "audit_logs"),
        ("Payment Corrections", "payment_revisions"), ("Issued Documents", "issued_documents"),
    ]
    # A PDF is a readable report, not a restorable backup: keep the original ZIP.
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("mtc_pdf_cell", parent=styles["Normal"], fontSize=7, leading=10)
    muted = ParagraphStyle("mtc_pdf_meta", parent=styles["Normal"], fontSize=8, leading=11, textColor=colors.HexColor("#556070"))
    story = [Paragraph(f"{xml_escape(cid)} - Business Records Report", styles["Title"]),
             Paragraph(f"Generated: {xml_escape(now_iso())} (UTC). Read-only report. Preserve Full Backup ZIP for restore.", muted),
             Spacer(1, 10)]
    def printable(v):
        if isinstance(v, (dict, list)):
            v = json.dumps(v, ensure_ascii=False, default=str)
        return str(v if v is not None else "")
    total = 0
    groups.extend([("Company settings", "settings"), ("Vehicle photo references", "vehicle_photos"),
                   ("Delivery statuses", "customer_delivery_status")])
    for company in company_ids:
        story.append(Paragraph(company, styles["Heading1"]))
        for heading, col in groups:
            records = await backup_rows(company, col)
            total += len(records)
            if total > 40000:
                raise HTTPException(413, "PDF report too large. Download the ZIP.")
            story.append(Paragraph(f"{heading} ({len(records)})",styles["Heading2"]))
            for index, record in enumerate(records, 1):
                story.append(Paragraph(f"#{index}", muted))
                for key, value in record.items():
                    if key in ("company_id", "pdf") or (key == "logo_url" and str(value).startswith("data:")):
                        continue
                    text = printable(value)
                    for pos in range(0, max(len(text),1), 600):
                        label = key.replace("_"," ").title() if pos == 0 else ""
                        story.append(Paragraph(printable_markup(label+"  "+text[pos:pos+600]), normal))
                story.append(Spacer(1,4))
    b = BytesIO()
    SimpleDocTemplate(b, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                      topMargin=15 * mm, bottomMargin=15 * mm).build(story)
    b.seek(0)
    return StreamingResponse(b, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{cid}-BUSINESS-REPORT-{now_iso()[:10]}.pdf"'
    })


@api.get("/owner/backup.zip")
async def owner_backup_zip(user: dict = Depends(require("settings.manage"))):
    cid = current_company.get()
    return zip_response(await business_zip(cid), cid+"-FULL-BACKUP-"+now_iso()[:10]+".zip")


def zip_response(content, name):
    return StreamingResponse(BytesIO(content), media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def backup_rows(cid, coll):
    if coll == "settings":
        doc = await db.settings.find_one({"id": "company:"+cid}, {"_id":0})
        return [doc] if doc else []
    if coll == "customer_delivery_status":
        # Older versions stored delivery flags without a tenant field.
        ids = await db.customers.distinct("id", {"company_id":cid})
        return await db[coll].find({"customer_id":{"$in":ids}, "company_id":{"$in":[None,cid]}},{"_id":0}).to_list(None)
    return await db[coll].find({"company_id":cid},{"_id":0}).to_list(None)


async def business_zip(cid):
    all_data = {}
    for coll in sorted(PER_COMPANY_COLLECTIONS | {"customer_delivery_status","settings"}):
        all_data[coll] = await backup_rows(cid, coll)
    info = {"company": cid, "backup_date": now_iso(), "format_version": 1,
            "note": "Cumulative full business-data backup. Container & TT is backed up but remains isolated from Funds."}
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Backup-Info.json", json.dumps(info, ensure_ascii=False, indent=2, default=str))
        z.writestr("RAW/full-backup.json", json.dumps({"info": info, **all_data}, ensure_ascii=False, indent=2, default=str))
        folders = {
            "Vehicles": ["vehicles", "tracked_parts", "part_sales"],
            "Parts-Engine-HalfCut": ["parts", "tracked_parts"],
            "Customers-Sales": ["customers", "invoices", "payments", "customer_shipping"],
            "Expenses-Salary": ["expenses", "employees", "salaries"],
            "Brokers": ["brokers", "broker_vehicles", "broker_payments"],
            "Loans-Udhaar": ["loans", "loan_entries"],
            "Cash-Bank-Funds": ["fund_entries"],
            "Fiscal-Years": ["monthly_summaries", "monthly_summary_years", "fiscal_years", "fiscal_snapshots"],
            "Scrap-Shokubai-Small-Sales": ["scrap_allocations", "shokubai_allocations", "small_sales"],
            "Container-TT": ["container_invoices", "income_tt", "bl_amounts"],
            "System": ["audit_logs", "payment_revisions", "settings","customer_delivery_status","vehicle_photos"],
            "Invoice-Archive": ["issued_documents"],
        }
        for folder, colls in folders.items():
            for coll in colls:
                rows = all_data.get(coll, [])
                z.writestr(f"{folder}/{coll}.json", json.dumps(rows, ensure_ascii=False, indent=2, default=str))
                z.writestr(f"{folder}/{coll}.csv", _csv_bytes(rows))
    return buf.getvalue()


class CombinedExport(BaseModel):
    password: str


@api.post("/owner/combined/{fmt}")
async def combined_export(fmt: str, body: CombinedExport, user: dict = Depends(require("settings.manage"))):
    account = await db.users.find_one({"id":user["id"],"role":"Owner"})
    if not account or not verify_password(body.password, account["password_hash"]):
        raise HTTPException(403,"Verify the owner password to export both companies")
    if fmt == "pdf":
        return await business_report(sorted(VALID_COMPANIES))
    if fmt != "zip":
        raise HTTPException(404)
    out = BytesIO()
    with zipfile.ZipFile(out,"w",zipfile.ZIP_STORED) as bundle:
        for cid in sorted(VALID_COMPANIES):
            bundle.writestr(cid+"-business.zip", await business_zip(cid))
    return zip_response(out.getvalue(),"MTC-TSK-BUSINESS-"+now_iso()[:10]+".zip")


# Standalone invoice documents never post inventory, payments or accounting entries.
from paperwork import invoice_pdf, printable_markup
from uuid import UUID
from decimal import Decimal
from fastapi import UploadFile, File
from starlette.responses import Response
import hashlib
import re


class PaperParty(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    address: str = Field(default="", max_length=350)
    phone: str = ""
    bank_details: str = Field(default="", max_length=350)
    tax_id: str = Field(default="", pattern=r"^(T[0-9]{13})?$")


class PaperRow(BaseModel):
    date: date
    name: str = Field(min_length=1, max_length=160)
    chassis: str = Field(default="", max_length=80)
    gross: int = Field(ge=0, le=999999999999)


class PaperRequest(BaseModel):
    request_id: UUID
    kind: str = Field(pattern="^(broker|customer|manual)$")
    party_id: str = ""
    selected: List[str] = Field(default_factory=list, max_length=1000)
    seller: Optional[PaperParty] = None
    rows: List[PaperRow] = Field(default_factory=list, max_length=1000)


def paper_permission(kind, user):
    perm = {"broker": "finance.view", "customer": "customers.view", "manual": "settings.manage"}.get(kind)
    if not perm or perm not in user["permissions"]:
        raise HTTPException(403, "Company document access required")


async def paper_source(kind, pid, user):
    paper_permission(kind, user)
    coll = sdb.brokers if kind == "broker" else sdb.customers
    party = await coll.find_one({"id": pid}, {"_id": 0})
    if not party:
        raise HTTPException(404, "Party not found")
    rows = []
    def append(key, when, name, chassis, price):
        rows.append({"key": key, "date": str(when or "")[:10], "name": name or "Vehicle",
                     "chassis": chassis or "", "gross": price or 0})
    if kind == "broker":
        async for v in sdb.broker_vehicles.find({"broker_id": pid}).sort("purchase_date", -1):
            append(v["id"], v.get("purchase_date"), v.get("vehicle_name"), v.get("chassis_number"), v.get("purchase_price"))
    else:
        seen = set()
        async for inv in sdb.invoices.find({"customer_id": pid}).sort("created_at", -1):
            for idx, line in enumerate(inv.get("items", [])):
                if line.get("item_type") != "vehicle":
                    continue
                vid = line.get("ref_id")
                v = (await sdb.vehicles.find_one({"id": vid}) or {}) if vid else {}
                seen.add(vid)
                append(f'{inv["id"]}:{idx}', inv.get("sale_date") or inv.get("created_at"),
                       v.get("vehicle_name") or line.get("description"), v.get("chassis_number"),
                       line.get("unit_price"))
        async for v in sdb.vehicles.find({"customer_id": pid, "status": {"$in":["sold_complete","sold"]}}):
            if v["id"] not in seen:
                append(v["id"], v.get("sale_date"), v.get("vehicle_name"), v.get("chassis_number"), v.get("sale_price"))
    return party, rows


@api.get("/paper/source/{kind}/{pid}")
async def paper_choices(kind: str, pid: str, user: dict = Depends(get_current_user)):
    if kind not in ("broker","customer"):
        raise HTTPException(404)
    _, rows = await paper_source(kind, pid, user)
    return rows


@api.post("/paper")
async def issue_document(body: PaperRequest, user: dict = Depends(get_current_user)):
    paper_permission(body.kind, user)
    cid = current_company.get()
    key = f"{cid}:{user['id']}:{body.request_id}"
    existing = await sdb.issued_documents.find_one({"id":str(uuid.uuid5(uuid.NAMESPACE_URL,key))})
    if existing:
        return {"id": existing["id"]}
    settings = await sdb.settings.find_one({"id": settings_id()}, {"_id": 0}) or {}
    if not settings.get("name"):
        raise HTTPException(400, "Save the active company's name in Settings first")
    if body.kind == "manual":
        if not body.seller:
            raise HTTPException(400, "Enter seller name")
        party = body.seller.model_dump()
        rows = [r.model_dump(mode="json") for r in body.rows]
    else:
        party, available = await paper_source(body.kind, body.party_id, user)
        selected = set(body.selected)
        rows = [r for r in available if r["key"] in selected]
        if len(rows) != len(body.selected):
            raise HTTPException(409, "Vehicle selection changed. Reopen and select again.")
    if not rows:
        raise HTTPException(400, "Select or enter a vehicle")
    for row in rows:
        price = Decimal(str(row["gross"]))
        if not price.is_finite() or price < 0 or price != price.to_integral_value():
            raise HTTPException(400, "A whole-yen vehicle price is required")
        row["gross"] = int(price)
    fields = ("name","phone","address","email","tax_id","bank_details","bank_name","branch","branch_code","account_number","account_name")
    source, target = (settings,party) if body.kind == "customer" else (party,settings)
    doc = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL,key)), "kind": body.kind, "company_id": cid, "created_by": user["id"],
           "number": f"{cid}-{uuid.uuid5(uuid.NAMESPACE_URL,key).hex[:16].upper()}", "date": datetime.now(timezone(timedelta(hours=9))).date().isoformat(),
           "from": {k: source.get(k) for k in fields}, "to": {k: target.get(k) for k in ("name","phone","address")},
           "party": party["name"], "rows": rows, "created_at": now_iso()}
    binary = invoice_pdf(doc)
    doc["pdf"] = base64.b64encode(binary).decode()
    await db.issued_documents.update_one({"_id": key}, {"$setOnInsert": doc}, upsert=True)
    return {"id": doc["id"]}


@api.get("/paper/archive")
async def archive_search(q: str = "", user: dict = Depends(require("settings.manage"))):
    cond = {}
    if q.strip():
        term = {"$regex": re.escape(q.strip()[:120]), "$options": "i"}
        cond["$or"] = [{k: term} for k in ("number","party","rows.name","rows.chassis")]
    return await sdb.issued_documents.find(cond, {"_id":0,"id":1,"number":1,"party":1,"date":1}).sort("created_at",-1).to_list(None)


@api.get("/paper/{doc_id}/pdf")
async def document_pdf(doc_id: str, user: dict = Depends(get_current_user)):
    doc = await sdb.issued_documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404)
    if "settings.manage" not in user["permissions"]:
        paper_permission(doc["kind"], user)
        if doc.get("created_by") != user["id"]:
            raise HTTPException(403)
    return Response(base64.b64decode(doc["pdf"]), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{doc["number"]}.pdf"'})


@api.get("/record-search")
async def record_search(q: str, user: dict = Depends(get_current_user)):
    if not q.strip():
        return []
    term = {"$regex":re.escape(q.strip()[:120]),"$options":"i"}
    sources = [
        ("Vehicles","vehicles","vehicles.view","vehicle_name chassis_number make model engine_number supplier","vehicles","id"),
        ("Brokers","brokers","finance.view","name phone address","brokers","id"),
        ("Broker vehicles","broker_vehicles","finance.view","vehicle_name chassis_number","brokers","broker_id"),
        ("Customers","customers","customers.view","name phone address","customers","id"),
        ("Customer sales","invoices","customers.view","invoice_number items.description","customers","customer_id"),
        ("Parts","parts","parts.view","name source_chassis part_number category","parts",""),
        ("Tracked parts","tracked_parts","parts.view","name chassis_number engine_number vehicle_name","recovery",""),
        ("Part sales","part_sales","customers.view","part_name chassis_number engine_number invoice_number","customers","customer_id"),
        ("Expenses","expenses","finance.view","description category note","expenses",""),
        ("Container & TT","container_invoices","finance.view","company_name invoice_number container_no","container",""),
        ("Loans","loans","reports.view","name","loans",""),
        ("Monthly summary","monthly_summaries","finance.view","month year_month note","container",""),
        ("Shipping","customer_shipping","customers.view","container_number invoice_number note","customers","customer_id"),
        ("Funds","fund_entries","settings.manage","category description date","funds",""),
        ("Salaries","employees","finance.view","name phone","expenses",""),
        ("Income TT","income_tt","finance.view","invoice_number note","container",""),
        ("BL amounts","bl_amounts","finance.view","container_no company_name invoice_number","container",""),
        ("Sales","small_sales","finance.view","description note date","allocations",""),
        ("Invoices","issued_documents","settings.manage","number party rows.chassis rows.name","owner","id"),
    ]
    results = []
    # Resolve chassis matches through invoice references, including earlier sales.
    ids = await sdb.vehicles.find({"$or":[{k:term} for k in ("vehicle_name","chassis_number","model","make")]},{"id":1}).to_list(None) if "customers.view" in user["permissions"] else []
    for title, coll, perm, fields, route, target in sources:
        if perm not in user["permissions"]:
            continue
        clauses = [{k:term} for k in fields.split()]
        if coll == "invoices" and ids:
            clauses.append({"items.ref_id":{"$in":[r["id"] for r in ids]}})
        async for row in getattr(sdb,coll).find({"$or":clauses}).limit(100):
            label = " · ".join(str(row[k]) for k in fields.split() if row.get(k))
            results.append({"section":title,"label":label or row.get("id"),"route":route,"record":row.get(target,"")})
    if ids:
        for v in await sdb.vehicles.find({"id":{"$in":[r["id"] for r in ids]},"customer_id":{"$nin":[None,""]}}).to_list(None):
            if v.get("customer_id"):
                results.append({"section":"Customer vehicle","label":v.get("chassis_number") or v.get("vehicle_name"),"route":"customers","record":v["customer_id"]})
    return results


# Restore stages a company into an empty business ledger. Old-format backups may
# omit newer collections; their absence must never erase existing records.
@api.post("/owner/restore")
async def restore_business_backup(file: UploadFile = File(...), confirm: str = "", recovery_copy: bool = False, user: dict = Depends(require("settings.manage"))):
    cid = current_company.get()
    raw = await file.read(64*1024*1024+1)
    if len(raw) > 64*1024*1024:
        raise HTTPException(413,"Backup exceeds 64 MB")
    try:
        with zipfile.ZipFile(BytesIO(raw)) as bundle:
            scoped = cid+"-business.zip"
            if scoped in bundle.namelist() and "RAW/full-backup.json" not in bundle.namelist():
                if bundle.getinfo(scoped).file_size > 64*1024*1024:
                    raise HTTPException(413,"Company backup exceeds 64 MB")
                raw = bundle.read(scoped)
        with zipfile.ZipFile(BytesIO(raw)) as z:
            entry = z.getinfo("RAW/full-backup.json")
            if entry.file_size > 256*1024*1024:
                raise HTTPException(413,"Expanded backup exceeds 256 MB")
            data = json.loads(z.read(entry))
            info = data.pop("info")
            if not isinstance(info.get("backup_date"),str) or info["company"] != cid or info["format_version"] != 1:
                raise ValueError("Wrong company or format")
            required = PER_COMPANY_COLLECTIONS - {"vehicle_photos","issued_documents","customer_delivery_status"}
            if not (required | {"settings"}).issubset(data) or set(data) - (PER_COMPANY_COLLECTIONS | {"settings","customer_delivery_status"}):
                raise ValueError("Incomplete or unknown backup structure")
            for coll, rows in data.items():
                if not isinstance(rows,list):
                    raise ValueError("Invalid record list")
                if coll=="settings" and rows==[{}]:
                    rows.clear()
                seen=set()
                for row in rows:
                    if not isinstance(row,dict) or row.get("company_id",cid)!=cid or "_id" in row:
                        raise ValueError("Invalid company record")
                    if coll=="settings" and row.get("id")!=settings_id():
                        raise ValueError("Invalid settings")
                    if coll == "customer_delivery_status":
                        if not row.get("customer_id") or row.get("sale_type") not in ("invoice","tracked_sale","part_sale"):
                            raise ValueError("Invalid delivery flag")
                    if coll == "vehicle_photos" and any(not str(row.get(k,"")).startswith("vehicle-photos/"+cid+"/") for k in ("object_key","thumb_key")):
                        raise ValueError("Invalid photo reference")
                    if row.get("id"):
                        if row["id"] in seen:
                            raise ValueError("Duplicate record ID")
                        seen.add(row["id"])
                    row["company_id"]=cid
    except (ValueError, KeyError, AttributeError, TypeError, zipfile.BadZipFile) as exc:
        raise HTTPException(400,"Invalid business backup: "+str(exc)) from exc
    def linked(child, field, parent):
        known = {r.get("id") for r in data.get(parent, [])}
        for record in data.get(child, []):
            if record.get(field) and record[field] not in known:
                raise HTTPException(400, f"Missing {parent} record for {child}.{field}")
    for relation in [("broker_vehicles","broker_id","brokers"),("broker_payments","broker_id","brokers"),
                     ("payments","customer_id","customers"),("payments","invoice_id","invoices"),
                     ("invoices","customer_id","customers"),("loan_entries","loan_id","loans"),
                     ("customer_delivery_status","customer_id","customers")]:
        linked(*relation)
    digest=hashlib.sha256(raw).hexdigest()
    counts={k:len(v) for k,v in data.items()}
    if not confirm:
        return {"company":cid,"date":info["backup_date"],"counts":counts,"digest":digest}
    if confirm!=digest:
        raise HTTPException(409,"Preview the selected ZIP first")
    async def verify_rows(target, expected, session=None):
        # Compare every field, including original IDs, links and yen amounts.
        # Some legacy tables have composite keys; verification must allow them.
        def fingerprint(row):
            payload = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",",":"), allow_nan=False)
            return hashlib.sha256(payload.encode()).digest()
        expected_hashes = sorted(fingerprint(row) for row in expected)
        found = [fingerprint(row) async for row in target.find({"company_id":cid},{"_id":0},session=session)]
        if sorted(found) != expected_hashes:
            raise HTTPException(409, "Restored records differ from the supplied ZIP")
    async def apply(session):
        # Serialize overlapping restore operations for the same company.
        await db.restore_locks.update_one({"_id":cid},{"$inc":{"generation":1}},upsert=True,session=session)
        for coll in required | {"issued_documents","vehicle_photos"}:
            if await db[coll].find_one({"company_id":cid},{"_id":1},session=session):
                raise HTTPException(409,"Restore requires an empty test company database")
        for coll,rows in data.items():
            target=db[coll]
            if coll=="settings":
                if rows:
                    await target.replace_one({"id":settings_id()},rows[0],upsert=True,session=session)
                    await verify_rows(target,rows,session)
                continue
            if rows:
                await target.insert_many([dict(r) for r in rows],session=session)
            await verify_rows(target,rows,session)
    from pymongo.errors import PyMongoError
    if recovery_copy:
        # A standalone Mongo server cannot commit a multi-collection transaction.
        # Write exclusively to a fresh, unpublished recovery database instead.
        target_name = "recovery_"+cid.lower()+"_"+uuid.uuid4().hex
        target_db = client[target_name]
        try:
            for coll, rows in data.items():
                if rows:
                    await target_db[coll].insert_many([dict(r) for r in rows])
                await verify_rows(target_db[coll], rows)
            await target_db.restore_status.insert_one({"company_id":cid,"complete":True,"sha256":digest,"counts":counts})
        except PyMongoError as exc:
            raise HTTPException(409,"Could not finish the separate recovery database. Check MongoDB permissions. Incomplete target: "+target_name) from exc
        return {"restored":counts,"company":cid,"database":target_name}
    try:
        async with await client.start_session() as session:
            await session.with_transaction(apply)
    except PyMongoError as exc:
        raise HTTPException(409,"Restore could not commit. Use an empty MongoDB replica set with transaction support.") from exc
    return {"restored":counts,"company":cid}


@app.on_event("startup")
async def startup():
    await db["users"].create_index("email", unique=True)
    await db["invoices"].create_index("created_at")
    await db["payments"].create_index("created_at")
    await db["parts"].create_index("quantity")
    # chassis uniqueness is now per-company (MTC & TSK may reuse a chassis)
    try:
        await db["vehicles"].drop_index("chassis_number_1")
    except Exception:
        pass
    try:
        await db["vehicles"].create_index([("company_id", 1), ("chassis_number", 1)], unique=True)
    except Exception:
        pass
    # ---- ADDITIVE multi-company migration (no deletes): all existing records are MTC ----
    for coll in ["vehicles", "parts", "tracked_parts", "part_sales", "customers", "invoices",
                 "payments", "expenses", "employees", "salaries", "customer_shipping", "scrap_allocations",
                 "shokubai_allocations", "small_sales", "audit_logs", "brokers", "broker_vehicles", "broker_payments",
                 "loans", "loan_entries", "container_invoices", "income_tt", "bl_amounts",
                 "monthly_summaries", "monthly_summary_years", "fund_entries", "fiscal_years", "fiscal_snapshots"]:
        await db[coll].update_many({"company_id": {"$exists": False}}, {"$set": {"company_id": "MTC"}})
        await db[coll].create_index("company_id")
    try:
        await db["monthly_summaries"].create_index(
            [("company_id", 1), ("fiscal_year_start", 1), ("month", 1)], unique=True
        )
    except Exception:
        pass
    try:
        await db["monthly_summary_years"].create_index(
            [("company_id", 1), ("fiscal_year_start", 1)], unique=True
        )
    except Exception:
        pass
    # migrate legacy single settings doc -> per-company MTC settings
    legacy = await db["settings"].find_one({"id": "company"})
    if legacy and not await db["settings"].find_one({"id": "company:MTC"}):
        legacy = {k: v for k, v in legacy.items() if k != "_id"}
        legacy.update({"id": "company:MTC", "company_id": "MTC", "short_name": legacy.get("short_name", "MTC")})
        await db["settings"].insert_one(legacy)
    if not await db["settings"].find_one({"id": "company:MTC"}):
        s = CompanySettings().model_dump()
        s.update({"id": "company:MTC", "company_id": "MTC", "short_name": "MTC"})
        await db["settings"].insert_one(s)
    # seed TSK settings (Towa Shokai Corp) — blank prefix until user configures it
    if not await db["settings"].find_one({"id": "company:TSK"}):
        s = CompanySettings().model_dump()
        s.update({"id": "company:TSK", "company_id": "TSK", "short_name": "TSK",
                  "name": "Towa Shokai Corp", "logo_url": "/logo-tsk.png",
                  "invoice_prefix": "", "address": "", "phone": "", "email": ""})
        await db["settings"].insert_one(s)
    # ---- seed roles (global) ----
    for name, perms in DEFAULT_ROLES.items():
        existing = await db["roles"].find_one({"name": name})
        if not existing:
            await db["roles"].insert_one({"id": new_id(), "name": name,
                                          "permissions": perms, "is_system": True})
        else:
            await db["roles"].update_one({"name": name}, {"$set": {"permissions": perms, "is_system": True}})
    # ---- seed owner (global) ----
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_pw = os.environ["ADMIN_PASSWORD"]
    existing = await db["users"].find_one({"email": admin_email})
    if not existing:
        await db["users"].insert_one({"id": new_id(), "name": "Owner",
                                      "email": admin_email, "password_hash": hash_password(admin_pw),
                                      "role": "Owner", "active": True, "created_at": now_iso()})
        logger.info(f"Seeded owner account {admin_email}")
    elif not verify_password(admin_pw, existing["password_hash"]):
        await db["users"].update_one({"email": admin_email},
                                     {"$set": {"password_hash": hash_password(admin_pw), "role": "Owner"}})
    # seed default app PIN (0433) if none set — never overwrite an existing PIN
    owner = await db["users"].find_one({"email": admin_email})
    if owner and not owner.get("pin_hash"):
        await db["users"].update_one({"email": admin_email}, {"$set": {"pin_hash": hash_password("0433")}})
        logger.info("Seeded default app PIN")


@app.on_event("shutdown")
async def shutdown():
    client.close()



# Read-only reference catalog bundled from the owner's M-AI.xlsx.
# This is NOT an inventory/vehicle-entry collection and never modifies business records.
_VEHICLE_CATALOG_PATH = ROOT_DIR / "vehicle_catalog.json"
with open(_VEHICLE_CATALOG_PATH, encoding="utf-8") as _catalog_file:
    VEHICLE_CATALOG = json.load(_catalog_file)

def _catalog_code(value: str) -> str:
    return "".join(ch for ch in (value or "").upper() if ch.isalnum())

@api.get("/vehicle-catalog/search")
async def vehicle_catalog_search(q: str = "", user: dict = Depends(get_current_user)):
    if not any(p in user.get("permissions", []) for p in ("vehicles.view", "vehicles.edit")):
        raise HTTPException(status_code=403, detail="Permission denied")
    term = _catalog_code(q)[:80]
    if len(term) < 2:
        return []
    matches = []
    for entry in VEHICLE_CATALOG:
        code = _catalog_code(entry.get("model_code", ""))
        # Exact model code, chassis prefix (e.g. NZE121-12345), or partial model code.
        if code and (term == code or term.startswith(code) or code.startswith(term)):
            matches.append((0 if term == code else 1 if term.startswith(code) else 2, -len(code), entry))
    matches.sort(key=lambda x: (x[0], x[1], x[2].get("make", ""), x[2].get("vehicle_name", "")))
    return [m[2] for m in matches[:30]]

app.include_router(api)


@app.middleware("http")
async def company_context(request: Request, call_next):
    cid = request.headers.get("X-Company-Id") or request.query_params.get("company") or DEFAULT_COMPANY
    if cid not in VALID_COMPANIES:
        cid = DEFAULT_COMPANY
    tok = current_company.set(cid)
    try:
        return await call_next(request)
    finally:
        current_company.reset(tok)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
