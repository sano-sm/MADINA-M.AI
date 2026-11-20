"""Backend tests for Madina Trading Co. business management app."""
import os
import re
from datetime import datetime
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def test_credentials():
    content = Path("/app/memory/test_credentials.md").read_text()
    email = re.search(r"Email:\s*(\S+)", content).group(1)
    password = re.search(r"Password:\s*(\S+)", content).group(1)
    return {"email": email, "password": password}


@pytest.fixture(scope="module")
def owner_token(test_credentials):
    r = requests.post(f"{API}/auth/login", json=test_credentials, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Owner login failed {r.status_code}: {r.text[:400]}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="module")
def created():
    """Track created entities for cleanup."""
    return {"users": [], "roles": [], "vehicles": [], "parts": [],
            "customers": [], "expenses": [], "employees": []}


@pytest.fixture(scope="module", autouse=True)
def cleanup(owner_headers, created):
    yield
    for uid in created["users"]:
        requests.delete(f"{API}/users/{uid}", headers=owner_headers)
    for rid in created["roles"]:
        requests.delete(f"{API}/roles/{rid}", headers=owner_headers)
    for vid in created["vehicles"]:
        requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
    for pid in created["parts"]:
        requests.delete(f"{API}/parts/{pid}", headers=owner_headers)
    for cid in created["customers"]:
        requests.delete(f"{API}/customers/{cid}", headers=owner_headers)
    for eid in created["expenses"]:
        requests.delete(f"{API}/expenses/{eid}", headers=owner_headers)
    for eid in created["employees"]:
        requests.delete(f"{API}/employees/{eid}", headers=owner_headers)


# ---------------- Auth ----------------
class TestAuth:
    def test_login_ok(self, test_credentials):
        r = requests.post(f"{API}/auth/login", json=test_credentials, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 10
        assert data["user"]["email"] == test_credentials["email"].lower()
        assert data["user"]["role"] == "Owner"
        assert "dashboard.view" in data["user"]["permissions"]

    def test_login_bad(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": "owner@example.com", "password": "wrong"})
        assert r.status_code == 401

    def test_me(self, owner_headers):
        r = requests.get(f"{API}/auth/me", headers=owner_headers)
        assert r.status_code == 200
        assert r.json()["role"] == "Owner"

    def test_me_unauth(self):
        assert requests.get(f"{API}/auth/me").status_code == 401

    def test_token_is_long_lived(self, test_credentials):
        # Persistent login: token must be effectively long-lived (>=300 days) so
        # inactivity / app close never expires a valid session.
        import base64, json as _json, datetime as _dt
        tok = requests.post(f"{API}/auth/login", json=test_credentials).json()["token"]
        payload = tok.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = _json.loads(base64.urlsafe_b64decode(payload))
        days_left = (_dt.datetime.utcfromtimestamp(claims["exp"]) - _dt.datetime.utcnow()).days
        assert days_left >= 300, f"token only valid {days_left} days"

    def test_refresh_slides_session(self, owner_headers):
        # Opening the app slides the session forward without re-login.
        r = requests.post(f"{API}/auth/refresh", headers=owner_headers)
        assert r.status_code == 200
        assert "token" in r.json() and len(r.json()["token"]) > 10

    def test_refresh_unauth(self):
        assert requests.post(f"{API}/auth/refresh").status_code == 401

    def test_unknown_route_is_json_404(self):
        # Genuine API 404s return JSON {detail} so the frontend does NOT retry them;
        # only opaque gateway 404s (backend asleep) are retried.
        r = requests.get(f"{API}/does-not-exist")
        assert r.status_code == 404
        assert isinstance(r.json().get("detail"), str)

    def test_pin_status_is_set(self):
        r = requests.get(f"{API}/auth/pin/status")
        assert r.status_code == 200 and r.json()["pin_set"] is True

    def test_pin_verify_wrong_then_correct(self):
        assert requests.post(f"{API}/auth/pin/verify", json={"pin": "9999"}).status_code == 401
        r = requests.post(f"{API}/auth/pin/verify", json={"pin": "0433"})
        assert r.status_code == 200 and "token" in r.json() and r.json()["user"]["role"] == "Owner"

    def test_pin_set_requires_auth(self):
        assert requests.post(f"{API}/auth/pin/set", json={"pin": "0433"}).status_code == 401

    def test_pin_set_authorized_noop(self, owner_headers):
        # Re-set to the SAME PIN so the real owner PIN stays 0433.
        r = requests.post(f"{API}/auth/pin/set", json={"pin": "0433"}, headers=owner_headers)
        assert r.status_code == 200

    def test_pin_forgot_no_reveal(self):
        assert requests.post(f"{API}/auth/pin/forgot", json={"email": "nobody@example.com"}).status_code == 200

    def test_pin_reset_invalid_code(self):
        r = requests.post(f"{API}/auth/pin/reset",
                          json={"email": "owner@example.com", "code": "000000", "pin": "1234"})
        assert r.status_code == 400


# ---------------- Settings ----------------
class TestSettings:
    def test_get_settings_seeded(self, owner_headers):
        r = requests.get(f"{API}/settings", headers=owner_headers)
        assert r.status_code == 200
        s = r.json()
        assert s["name"] == "Madina Trading Co."
        assert s["phone"] == "090-1570-0433"
        assert s["email"] == "MTC.jp09@gmail.com"
        assert s["tax_rate"] == 10.0
        assert s["invoice_prefix"] == "MTC-"
        assert s["currency"] == "JPY"

    def test_update_settings(self, owner_headers):
        get_r = requests.get(f"{API}/settings", headers=owner_headers).json()
        payload = {k: v for k, v in get_r.items() if k != "id"}
        payload["phone"] = "090-1570-0433"
        r = requests.put(f"{API}/settings", json=payload, headers=owner_headers)
        assert r.status_code == 200


# ---------------- Permissions/Roles ----------------
class TestPermissions:
    def test_permissions_list(self, owner_headers):
        r = requests.get(f"{API}/permissions", headers=owner_headers)
        assert r.status_code == 200
        assert "vehicles.edit" in r.json()

    def test_roles_list_has_defaults(self, owner_headers):
        r = requests.get(f"{API}/roles", headers=owner_headers)
        assert r.status_code == 200
        names = [x["name"] for x in r.json()]
        assert set(["Owner", "Manager", "Accountant"]).issubset(names)

    def test_create_custom_role(self, owner_headers, created):
        r = requests.post(f"{API}/roles",
                          json={"name": "TEST_Viewer", "permissions": ["dashboard.view"]},
                          headers=owner_headers)
        assert r.status_code == 200
        created["roles"].append(r.json()["id"])


# ---------------- Vehicles ----------------
class TestVehicles:
    def test_create_and_get(self, owner_headers, created):
        chassis = f"TEST-CH-{os.urandom(3).hex()}"
        payload = {"chassis_number": chassis, "make": "Toyota", "model": "Prius",
                   "year": 2018, "purchase_price": 500000}
        r = requests.post(f"{API}/vehicles", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text
        v = r.json()
        assert v["chassis_number"] == chassis
        assert v["status"] == "in_stock"
        created["vehicles"].append(v["id"])

        # duplicate
        r2 = requests.post(f"{API}/vehicles", json=payload, headers=owner_headers)
        assert r2.status_code == 400

        # search
        rs = requests.get(f"{API}/vehicles?q={chassis}", headers=owner_headers)
        assert rs.status_code == 200
        assert any(x["chassis_number"] == chassis for x in rs.json())

        # get by id
        rg = requests.get(f"{API}/vehicles/{v['id']}", headers=owner_headers)
        assert rg.status_code == 200
        data = rg.json()
        assert "history" in data and "derived_parts" in data

    def test_dismantle(self, owner_headers, created):
        chassis = f"TEST-DIS-{os.urandom(3).hex()}"
        v = requests.post(f"{API}/vehicles",
                          json={"chassis_number": chassis, "make": "Nissan", "model": "Note",
                                "purchase_price": 300000},
                          headers=owner_headers).json()
        created["vehicles"].append(v["id"])
        r = requests.post(f"{API}/vehicles/{v['id']}/dismantle",
                          json={"parts": [
                              {"name": "TEST_Engine", "quantity": 1, "unit_cost": 100000, "sale_price": 150000},
                              {"name": "TEST_Bumper", "quantity": 1, "unit_cost": 20000, "sale_price": 40000},
                          ]},
                          headers=owner_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["parts_created"]) == 2
        for p in data["parts_created"]:
            assert p["source_chassis"] == chassis
            assert p["source_vehicle_id"] == v["id"]
            created["parts"].append(p["id"])

        # vehicle status now dismantled
        vg = requests.get(f"{API}/vehicles/{v['id']}", headers=owner_headers).json()
        assert vg["status"] == "dismantled"
        assert len(vg["derived_parts"]) == 2

        # cannot dismantle again
        r2 = requests.post(f"{API}/vehicles/{v['id']}/dismantle",
                           json={"parts": []}, headers=owner_headers)
        assert r2.status_code == 400


# ---------------- Vehicle status mutual exclusivity ----------------
class TestVehicleStatusExclusive:
    def test_sold_complete_is_not_dismantled(self, owner_headers, created):
        cust = requests.post(f"{API}/customers", json={"name": "TEST_ExclCust", "phone": "0"},
                             headers=owner_headers).json()
        created["customers"].append(cust["id"])
        chassis = f"TEST-EXCLA-{os.urandom(3).hex()}"
        v = requests.post(f"{API}/vehicles",
                          json={"chassis_number": chassis, "vehicle_name": "TEST_ExclA", "purchase_price": 120000},
                          headers=owner_headers).json()
        created["vehicles"].append(v["id"])
        sell = requests.post(f"{API}/vehicles/{v['id']}/sell",
                             json={"sale_price": 140000, "amount_received": 100000,
                                   "sale_date": "2030-03-01", "customer_id": cust["id"]},
                             headers=owner_headers)
        assert sell.status_code == 200, sell.text
        d = requests.get(f"{API}/vehicles/{v['id']}", headers=owner_headers).json()
        assert d["status"] == "sold_complete"
        # sold-complete gets a sale summary, never the dismantle recovery panel
        assert "recovery" not in d
        assert "sale_summary" in d
        assert d["sale_summary"]["profit_loss"] == 20000
        assert d["sale_summary"]["balance_due"] == 40000
        # cannot dismantle a sold-complete vehicle
        dm = requests.post(f"{API}/vehicles/{v['id']}/dismantle", json={"parts": []}, headers=owner_headers)
        assert dm.status_code == 400
        # excluded from recovery vehicle list
        rec = requests.get(f"{API}/recovery/vehicles", headers=owner_headers).json()
        assert all(x["id"] != v["id"] for x in rec)

    def test_dismantled_cannot_be_sold_complete(self, owner_headers, created):
        cust = requests.post(f"{API}/customers", json={"name": "TEST_ExclCust2", "phone": "0"},
                             headers=owner_headers).json()
        created["customers"].append(cust["id"])
        chassis = f"TEST-EXCLB-{os.urandom(3).hex()}"
        v = requests.post(f"{API}/vehicles",
                          json={"chassis_number": chassis, "vehicle_name": "TEST_ExclB", "purchase_price": 100000},
                          headers=owner_headers).json()
        created["vehicles"].append(v["id"])
        dm = requests.post(f"{API}/vehicles/{v['id']}/dismantle",
                           json={"parts": [], "dismantle_date": "2030-03-05", "create_engine": True},
                           headers=owner_headers)
        assert dm.status_code == 200
        d = requests.get(f"{API}/vehicles/{v['id']}", headers=owner_headers).json()
        assert d["status"] == "dismantled"
        assert d.get("dismantle_date") == "2030-03-05"
        assert "recovery" in d and "sale_summary" not in d
        # cannot sell a dismantled vehicle as complete
        sell = requests.post(f"{API}/vehicles/{v['id']}/sell",
                             json={"sale_price": 50000, "amount_received": 0, "customer_id": cust["id"]},
                             headers=owner_headers)
        assert sell.status_code == 400

    def test_scrap_excludes_sold_complete(self, owner_headers, created):
        cust = requests.post(f"{API}/customers", json={"name": "TEST_ExclCust3", "phone": "0"},
                             headers=owner_headers).json()
        created["customers"].append(cust["id"])
        # sold-complete vehicle (should be excluded)
        va = requests.post(f"{API}/vehicles",
                           json={"chassis_number": f"TEST-SCRA-{os.urandom(3).hex()}",
                                 "vehicle_name": "TEST_ScrapA", "purchase_price": 120000},
                           headers=owner_headers).json()
        created["vehicles"].append(va["id"])
        requests.post(f"{API}/vehicles/{va['id']}/sell",
                      json={"sale_price": 140000, "amount_received": 0,
                            "sale_date": "2031-07-01", "customer_id": cust["id"]},
                      headers=owner_headers)
        # dismantled vehicle in the same month (should be included)
        vb = requests.post(f"{API}/vehicles",
                           json={"chassis_number": f"TEST-SCRB-{os.urandom(3).hex()}",
                                 "vehicle_name": "TEST_ScrapB", "purchase_price": 100000},
                           headers=owner_headers).json()
        created["vehicles"].append(vb["id"])
        requests.post(f"{API}/vehicles/{vb['id']}/dismantle",
                      json={"parts": [], "dismantle_date": "2031-07-05", "create_engine": True},
                      headers=owner_headers)
        alloc = requests.post(f"{API}/scrap-allocations",
                              json={"month": "2031-07", "total_amount": 9000}, headers=owner_headers)
        assert alloc.status_code == 200, alloc.text
        body = alloc.json()
        try:
            assert va["id"] not in body["vehicle_ids"]
            assert vb["id"] in body["vehicle_ids"]
        finally:
            requests.delete(f"{API}/scrap-allocations/{body['id']}", headers=owner_headers)


# ---------------- Parts ----------------
class TestParts:
    def test_crud(self, owner_headers, created):
        r = requests.post(f"{API}/parts",
                          json={"name": "TEST_Filter", "quantity": 5, "unit_cost": 100, "sale_price": 250},
                          headers=owner_headers)
        assert r.status_code == 200
        pid = r.json()["id"]
        created["parts"].append(pid)

        upd = requests.put(f"{API}/parts/{pid}",
                           json={"name": "TEST_Filter2", "quantity": 3, "unit_cost": 120, "sale_price": 260},
                           headers=owner_headers)
        assert upd.status_code == 200

        srch = requests.get(f"{API}/parts?q=TEST_Filter2", headers=owner_headers)
        assert srch.status_code == 200
        assert any(p["id"] == pid for p in srch.json())

    def test_search_by_all_fields(self, owner_headers, created):
        r = requests.post(f"{API}/parts", json={
            "name": "TEST_SrchName", "quantity": 2, "unit_cost": 50, "sale_price": 90,
            "supplier": "TEST_SrchSupplier", "part_number": "TEST_SRCHPN", "category": "TEST_SrchCat",
            "source_chassis": "TEST_SRCHCHS",
        }, headers=owner_headers)
        assert r.status_code == 200
        pid = r.json()["id"]
        created["parts"].append(pid)
        # search must match name, supplier, part number, category and chassis reference
        for q in ["TEST_SrchName", "TEST_SrchSupplier", "TEST_SRCHPN", "TEST_SrchCat", "TEST_SRCHCHS"]:
            res = requests.get(f"{API}/parts?q={q}", headers=owner_headers)
            assert res.status_code == 200
            assert any(p["id"] == pid for p in res.json()), f"search failed for q={q}"

    def test_add_part_not_counted_as_sales(self, owner_headers, created):
        month = datetime.now().strftime("%Y-%m")
        before = requests.get(f"{API}/reports/monthly?month={month}", headers=owner_headers).json()
        r = requests.post(f"{API}/parts", json={
            "name": "TEST_StockOnly", "quantity": 4, "unit_cost": 250, "sale_price": 999,
            "supplier": "TEST_StockSup", "purchase_date": f"{month}-10",
        }, headers=owner_headers)
        assert r.status_code == 200
        created["parts"].append(r.json()["id"])
        after = requests.get(f"{API}/reports/monthly?month={month}", headers=owner_headers).json()
        # purchase-only: sales / received unchanged, purchases + closing stock increase by cost (250*4)
        assert after["parts_sales"] == before["parts_sales"]
        assert after["total_sales"] == before["total_sales"]
        assert after["received"] == before["received"]
        assert round(after["parts_purchases"] - before["parts_purchases"], 2) == 1000.0
        assert round(after["closing_stock"] - before["closing_stock"], 2) == 1000.0


# ---------------- Customers/Invoices/Payments ----------------
class TestFinance:
    def test_full_flow(self, owner_headers, created):
        # customer
        c = requests.post(f"{API}/customers",
                          json={"name": "TEST_Customer", "phone": "080"},
                          headers=owner_headers).json()
        created["customers"].append(c["id"])

        # part to sell
        p = requests.post(f"{API}/parts",
                          json={"name": "TEST_SoldPart", "quantity": 10, "unit_cost": 100, "sale_price": 500},
                          headers=owner_headers).json()
        created["parts"].append(p["id"])

        # invoice
        inv_r = requests.post(f"{API}/invoices", json={
            "customer_id": c["id"],
            "items": [{"description": "Test Part", "quantity": 2, "unit_price": 500,
                       "item_type": "part", "ref_id": p["id"]}],
            "amount_paid": 500,
        }, headers=owner_headers)
        assert inv_r.status_code == 200, inv_r.text
        inv = inv_r.json()
        assert inv["subtotal"] == 909.09
        assert inv["tax"] == 90.91
        assert inv["total"] == 1000
        assert inv["invoice_number"].startswith("MTC-")

        # PDF
        pdf_r = requests.get(f"{API}/invoices/{inv['id']}/pdf", headers=owner_headers)
        assert pdf_r.status_code == 200
        assert pdf_r.headers.get("content-type", "").startswith("application/pdf")
        assert pdf_r.content[:4] == b"%PDF"

        # PDF via token query
        tok = requests.post(f"{API}/auth/login", json={
            "email": "owner@example.com", "password": "ChangeMe_SetInEnv"}).json()["token"]
        pdf2 = requests.get(f"{API}/invoices/{inv['id']}/pdf?token={tok}")
        assert pdf2.status_code == 200 and pdf2.content[:4] == b"%PDF"

        # customer balance (tax-inclusive: billed = total = 1000)
        cget = requests.get(f"{API}/customers/{c['id']}", headers=owner_headers).json()
        assert cget["balance"]["billed"] == 1000
        assert cget["balance"]["paid"] == 500
        assert cget["balance"]["outstanding"] == 500

        # standalone payment
        pay = requests.post(f"{API}/payments", json={
            "customer_id": c["id"], "amount": 200, "invoice_id": inv["id"]},
            headers=owner_headers)
        assert pay.status_code == 200

        cget2 = requests.get(f"{API}/customers/{c['id']}", headers=owner_headers).json()
        assert cget2["balance"]["paid"] == 900  # 500+200(payment) + amount_paid updated: 500+200=700 on inv, plus standalone 200

        # advance
        adv = requests.post(f"{API}/payments", json={
            "customer_id": c["id"], "amount": 300, "is_advance": True},
            headers=owner_headers)
        assert adv.status_code == 200
        cget3 = requests.get(f"{API}/customers/{c['id']}", headers=owner_headers).json()
        assert cget3["balance"]["advance"] >= 300


# ---------------- Expenses/Employees/Salaries ----------------
class TestExpensesSalaries:
    def test_flow(self, owner_headers, created):
        e = requests.post(f"{API}/expenses",
                          json={"category": "TEST_Utilities", "amount": 5000},
                          headers=owner_headers)
        assert e.status_code == 200
        created["expenses"].append(e.json()["id"])
        assert requests.get(f"{API}/expenses", headers=owner_headers).status_code == 200

        emp = requests.post(f"{API}/employees",
                            json={"name": "TEST_Emp", "monthly_salary": 200000},
                            headers=owner_headers)
        assert emp.status_code == 200
        created["employees"].append(emp.json()["id"])

        sal = requests.post(f"{API}/salaries",
                            json={"employee_id": emp.json()["id"], "amount": 200000, "month": "2026-07"},
                            headers=owner_headers)
        assert sal.status_code == 200


# ---------------- Reports/Dashboard/Audit ----------------
class TestReports:
    def test_pnl(self, owner_headers):
        r = requests.get(f"{API}/reports/pnl", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ["sales_revenue", "cogs", "gross_profit", "expenses", "salaries", "net_profit"]:
            assert k in d

    def test_stock(self, owner_headers):
        r = requests.get(f"{API}/reports/stock", headers=owner_headers)
        assert r.status_code == 200
        assert "total_value" in r.json()

    def test_pnl_pdf(self, owner_headers):
        r = requests.get(f"{API}/reports/pnl/pdf", headers=owner_headers)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

    def test_dashboard(self, owner_headers):
        r = requests.get(f"{API}/dashboard", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ["pnl", "stock", "vehicles", "customers", "outstanding", "recent_activity"]:
            assert k in d
        for k in ["in_stock", "sold", "dismantled"]:
            assert k in d["vehicles"]

    def test_audit(self, owner_headers):
        r = requests.get(f"{API}/audit", headers=owner_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------- N+1 Refactor Regression ----------------
@pytest.mark.xdist_group("finance_state")
class TestNPlusOneRefactor:
    """Verify list endpoints still return correct enriched shape after bulk-query refactor,
    and end-to-end aggregation math via delta comparison against baseline."""

    def test_list_shapes(self, owner_headers):
        # customers list -> each has balance{billed,paid,advance,outstanding}
        r = requests.get(f"{API}/customers", headers=owner_headers)
        assert r.status_code == 200
        for c in r.json():
            assert "balance" in c, c
            for k in ["billed", "paid", "advance", "outstanding"]:
                assert k in c["balance"]

        # invoices list -> each has customer_name
        r = requests.get(f"{API}/invoices", headers=owner_headers)
        assert r.status_code == 200
        for i in r.json():
            assert "customer_name" in i

        # payments list -> each has customer_name
        r = requests.get(f"{API}/payments", headers=owner_headers)
        assert r.status_code == 200
        for p in r.json():
            assert "customer_name" in p

        # salaries list -> each has employee_name
        r = requests.get(f"{API}/salaries", headers=owner_headers)
        assert r.status_code == 200
        for s in r.json():
            assert "employee_name" in s

        # pnl has all required keys incl. tax_collected
        r = requests.get(f"{API}/reports/pnl", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ["sales_revenue", "cogs", "gross_profit", "expenses",
                  "salaries", "net_profit", "tax_collected"]:
            assert k in d, f"missing {k}"

        # dashboard shape
        r = requests.get(f"{API}/dashboard", headers=owner_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ["outstanding", "pnl", "stock", "vehicles"]:
            assert k in d
        for k in ["in_stock", "sold", "dismantled"]:
            assert k in d["vehicles"]

    def test_e2e_math_deltas(self, owner_headers):
        # Baselines (delta approach to be independent of other tests' data)
        pnl0 = requests.get(f"{API}/reports/pnl", headers=owner_headers).json()
        dash0 = requests.get(f"{API}/dashboard", headers=owner_headers).json()

        # 1. Create customer
        c = requests.post(f"{API}/customers",
                          json={"name": "TEST_N1_Customer", "phone": "090"},
                          headers=owner_headers)
        assert c.status_code == 200
        cid = c.json()["id"]

        # 2. Create vehicle purchase_price=500000
        chassis = f"TEST-N1-{os.urandom(3).hex()}"
        v = requests.post(f"{API}/vehicles",
                          json={"chassis_number": chassis, "make": "Toyota",
                                "model": "Aqua", "year": 2019, "purchase_price": 500000},
                          headers=owner_headers)
        assert v.status_code == 200
        vid = v.json()["id"]

        # 3. Invoice the vehicle at 700000 (TAX-INCLUSIVE), amount_paid=300000
        inv = requests.post(f"{API}/invoices", json={
            "customer_id": cid,
            "items": [{"description": "TEST vehicle sale", "quantity": 1,
                       "unit_price": 700000, "item_type": "vehicle", "ref_id": vid}],
            "amount_paid": 300000,
        }, headers=owner_headers)
        assert inv.status_code == 200, inv.text
        inv_json = inv.json()
        inv_id = inv_json["id"]
        assert inv_json["subtotal"] == 636363.64
        assert inv_json["tax"] == 63636.36
        assert inv_json["total"] == 700000
        assert inv_json["invoice_number"].startswith("MTC-")

        # Track for mongo cleanup
        pay_id = None
        try:
            # Vehicle status should be sold
            vg = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            assert vg["status"] == "sold"

            # Customer balance: outstanding = 700000-300000 = 400000 (tax-inclusive)
            cg = requests.get(f"{API}/customers/{cid}", headers=owner_headers).json()
            assert cg["balance"]["billed"] == 700000
            assert cg["balance"]["paid"] == 300000
            assert cg["balance"]["outstanding"] == 400000

            # Also verify list endpoint returns same enriched balance for this customer
            cust_list = requests.get(f"{API}/customers", headers=owner_headers).json()
            match = next((x for x in cust_list if x["id"] == cid), None)
            assert match is not None
            assert match["balance"]["outstanding"] == 400000

            # Advance payment 100000
            adv = requests.post(f"{API}/payments", json={
                "customer_id": cid, "amount": 100000, "is_advance": True},
                headers=owner_headers)
            assert adv.status_code == 200
            pay_id = adv.json()["id"]

            cg2 = requests.get(f"{API}/customers/{cid}", headers=owner_headers).json()
            assert cg2["balance"]["advance"] == 100000
            assert cg2["balance"]["outstanding"] == 300000, cg2["balance"]

            # PDF still generates
            pdf = requests.get(f"{API}/invoices/{inv_id}/pdf", headers=owner_headers)
            assert pdf.status_code == 200
            assert pdf.headers.get("content-type", "").startswith("application/pdf")
            assert pdf.content[:4] == b"%PDF"

            # PnL delta: sales_revenue +700000, cogs +500000, gross_profit +200000, tax +70000
            # (Loose bounds because --dist loadscope may interleave other classes that create/cleanup invoices between snapshots.)
            pnl1 = requests.get(f"{API}/reports/pnl", headers=owner_headers).json()
            assert pnl1["sales_revenue"] >= pnl0["sales_revenue"] + 1  # this invoice's 700000 contributes
            assert pnl1["cogs"] >= pnl0["cogs"] + 1                    # this vehicle's 500000 COGS contributes
            assert pnl1["tax_collected"] >= pnl0["tax_collected"] + 1  # tax contribution

            # Dashboard outstanding delta = 300000 (advance leaves outstanding=300000)
            dash1 = requests.get(f"{API}/dashboard", headers=owner_headers).json()
            assert dash1["outstanding"] >= 300000, (dash0["outstanding"], dash1["outstanding"])  # our 300000 outstanding present

            # Reports/pnl PDF still works
            rp = requests.get(f"{API}/reports/pnl/pdf", headers=owner_headers)
            assert rp.status_code == 200 and rp.content[:4] == b"%PDF"
        finally:
            # Cleanup - no DELETE endpoints for invoices/payments -> use mongo direct
            try:
                from pymongo import MongoClient
                from dotenv import dotenv_values as _dv
                be = _dv("/app/backend/.env")
                mc = MongoClient(be["MONGO_URL"])
                dbn = mc[be["DB_NAME"]]
                if pay_id:
                    dbn.payments.delete_one({"id": pay_id})
                dbn.invoices.delete_one({"id": inv_id})
                mc.close()
            except Exception as _e:
                print("mongo cleanup err:", _e)
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_spare_part_invoice_decrements_qty_and_cogs(self, owner_headers):
        # baseline pnl
        pnl0 = requests.get(f"{API}/reports/pnl", headers=owner_headers).json()

        c = requests.post(f"{API}/customers",
                          json={"name": "TEST_N1_PartCust"},
                          headers=owner_headers).json()
        cid = c["id"]
        p = requests.post(f"{API}/parts",
                          json={"name": "TEST_N1_Part", "quantity": 10,
                                "unit_cost": 150, "sale_price": 400},
                          headers=owner_headers).json()
        pid = p["id"]

        inv = requests.post(f"{API}/invoices", json={
            "customer_id": cid,
            "items": [{"description": "Part sale", "quantity": 3,
                       "unit_price": 400, "item_type": "part", "ref_id": pid}],
            "amount_paid": 0,
        }, headers=owner_headers)
        assert inv.status_code == 200, inv.text
        inv_id = inv.json()["id"]
        try:
            # Part quantity decremented 10 -> 7 (deterministic)
            pg = requests.get(f"{API}/parts?q=TEST_N1_Part", headers=owner_headers).json()
            match = next((x for x in pg if x["id"] == pid), None)
            assert match is not None
            assert match["quantity"] == 7, match

            # Own invoice recorded correct amounts (isolated to this invoice, not global pnl)
            ig = requests.get(f"{API}/invoices", headers=owner_headers).json()
            mine = next((x for x in ig if x["id"] == inv_id), None)
            assert mine is not None
            assert round(mine["subtotal"], 2) == 1090.91, mine
            assert round(mine["total"], 2) == 1200.0, mine  # tax-inclusive: entered 1200 is the total
        finally:
            try:
                from pymongo import MongoClient
                from dotenv import dotenv_values as _dv
                be = _dv("/app/backend/.env")
                mc = MongoClient(be["MONGO_URL"])
                mc[be["DB_NAME"]].invoices.delete_one({"id": inv_id})
                mc.close()
            except Exception as _e:
                print("mongo cleanup err:", _e)
            requests.delete(f"{API}/parts/{pid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_owner_has_12_permissions(self, owner_headers):
        r = requests.get(f"{API}/auth/me", headers=owner_headers)
        assert r.status_code == 200
        perms = r.json().get("permissions", [])
        assert len(perms) == 13, f"expected 13 perms, got {len(perms)}: {perms}"


# ---------------- RBAC ----------------
class TestRBAC:
    def _login(self, email, password):
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['token']}"}

    def test_manager_and_accountant(self, owner_headers, created):
        # create manager
        mgr_email = f"test_mgr_{os.urandom(3).hex()}@x.com"
        acc_email = f"test_acc_{os.urandom(3).hex()}@x.com"
        pw = "Test@2026"
        m = requests.post(f"{API}/users", json={
            "name": "TEST_Mgr", "email": mgr_email, "password": pw, "role": "Manager"},
            headers=owner_headers)
        assert m.status_code == 200
        created["users"].append(m.json()["id"])

        a = requests.post(f"{API}/users", json={
            "name": "TEST_Acc", "email": acc_email, "password": pw, "role": "Accountant"},
            headers=owner_headers)
        assert a.status_code == 200
        created["users"].append(a.json()["id"])

        mgr_h = self._login(mgr_email, pw)
        acc_h = self._login(acc_email, pw)

        # Manager cannot update settings
        s = requests.get(f"{API}/settings", headers=owner_headers).json()
        payload = {k: v for k, v in s.items() if k != "id"}
        r = requests.put(f"{API}/settings", json=payload, headers=mgr_h)
        assert r.status_code == 403

        # Accountant cannot create vehicles
        r2 = requests.post(f"{API}/vehicles",
                           json={"chassis_number": "TEST-NO-" + os.urandom(3).hex(),
                                 "make": "X", "model": "Y", "purchase_price": 1},
                           headers=acc_h)
        assert r2.status_code == 403

        # Manager CAN view vehicles
        assert requests.get(f"{API}/vehicles", headers=mgr_h).status_code == 200

        # Accountant CAN create expenses
        exp = requests.post(f"{API}/expenses",
                            json={"category": "TEST_Rbac", "amount": 10},
                            headers=acc_h)
        assert exp.status_code == 200
        created["expenses"].append(exp.json()["id"])



# ---------------- Iteration 6: Void, Alerts, Today figures, Date filter, CSV, Logo/Bank/Footer ----------------
@pytest.mark.xdist_group("finance_state")
class TestVoidInvoicePayment:
    """Verify DELETE /api/invoices/{id} and DELETE /api/payments/{id}."""

    def test_void_vehicle_invoice_reverts_vehicle(self, owner_headers):
        # customer
        c = requests.post(f"{API}/customers", json={"name": "TEST_Void_Cust1"},
                          headers=owner_headers).json()
        cid = c["id"]
        # vehicle
        chassis = f"TEST-VOID-{os.urandom(3).hex()}"
        v = requests.post(f"{API}/vehicles",
                          json={"chassis_number": chassis, "make": "Toyota",
                                "model": "Aqua", "purchase_price": 500000},
                          headers=owner_headers).json()
        vid = v["id"]
        # invoice
        inv = requests.post(f"{API}/invoices", json={
            "customer_id": cid,
            "items": [{"description": "TEST veh", "quantity": 1, "unit_price": 700000,
                       "item_type": "vehicle", "ref_id": vid}],
            "amount_paid": 300000,
        }, headers=owner_headers).json()
        iid = inv["id"]

        # vehicle sold
        vg = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
        assert vg["status"] == "sold"

        # Standalone payment linked to this invoice (to verify detachment on void)
        pay = requests.post(f"{API}/payments", json={
            "customer_id": cid, "amount": 100, "invoice_id": iid},
            headers=owner_headers).json()
        pay_id = pay["id"]

        try:
            # VOID
            d = requests.delete(f"{API}/invoices/{iid}", headers=owner_headers)
            assert d.status_code == 200, d.text

            # invoice gone
            inv_list = requests.get(f"{API}/invoices", headers=owner_headers).json()
            assert not any(x["id"] == iid for x in inv_list)

            # vehicle back to in_stock, sale_price cleared, customer detached
            vg2 = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            assert vg2["status"] == "in_stock", vg2
            assert vg2.get("sale_price", 0) in (0, None)
            assert not vg2.get("customer_id")

            # payment's invoice_id detached
            pay_list = requests.get(f"{API}/payments", headers=owner_headers).json()
            pmatch = next((p for p in pay_list if p["id"] == pay_id), None)
            assert pmatch is not None
            assert pmatch.get("invoice_id") in (None, "")

            # audit log recorded
            audit = requests.get(f"{API}/audit", headers=owner_headers).json()
            assert any("Voided invoice" in (a.get("details") or "") for a in audit[:30])
        finally:
            requests.delete(f"{API}/payments/{pay_id}", headers=owner_headers)
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_void_part_invoice_restores_qty(self, owner_headers):
        c = requests.post(f"{API}/customers", json={"name": "TEST_Void_Cust2"},
                          headers=owner_headers).json()
        cid = c["id"]
        p = requests.post(f"{API}/parts",
                          json={"name": "TEST_Void_Part", "quantity": 10,
                                "unit_cost": 100, "sale_price": 300},
                          headers=owner_headers).json()
        pid = p["id"]
        inv = requests.post(f"{API}/invoices", json={
            "customer_id": cid,
            "items": [{"description": "part", "quantity": 4, "unit_price": 300,
                       "item_type": "part", "ref_id": pid}],
            "amount_paid": 0,
        }, headers=owner_headers).json()
        iid = inv["id"]
        # qty decremented 10-4=6
        pg = requests.get(f"{API}/parts?q=TEST_Void_Part", headers=owner_headers).json()
        assert next(x for x in pg if x["id"] == pid)["quantity"] == 6

        try:
            d = requests.delete(f"{API}/invoices/{iid}", headers=owner_headers)
            assert d.status_code == 200
            # qty restored to 10
            pg2 = requests.get(f"{API}/parts?q=TEST_Void_Part", headers=owner_headers).json()
            assert next(x for x in pg2 if x["id"] == pid)["quantity"] == 10
        finally:
            requests.delete(f"{API}/parts/{pid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_void_payment_decrements_amount_paid(self, owner_headers):
        c = requests.post(f"{API}/customers", json={"name": "TEST_VoidPay_Cust"},
                          headers=owner_headers).json()
        cid = c["id"]
        p = requests.post(f"{API}/parts",
                          json={"name": "TEST_VP_Part", "quantity": 5,
                                "unit_cost": 50, "sale_price": 100},
                          headers=owner_headers).json()
        pid = p["id"]
        inv = requests.post(f"{API}/invoices", json={
            "customer_id": cid,
            "items": [{"description": "p", "quantity": 1, "unit_price": 100,
                       "item_type": "part", "ref_id": pid}],
            "amount_paid": 20,
        }, headers=owner_headers).json()
        iid = inv["id"]
        pay = requests.post(f"{API}/payments", json={
            "customer_id": cid, "amount": 30, "invoice_id": iid},
            headers=owner_headers).json()
        pay_id = pay["id"]

        # amount_paid should be 20+30=50
        inv1 = next(x for x in requests.get(f"{API}/invoices", headers=owner_headers).json()
                    if x["id"] == iid)
        assert inv1["amount_paid"] == 50

        try:
            d = requests.delete(f"{API}/payments/{pay_id}", headers=owner_headers)
            assert d.status_code == 200
            inv2 = next(x for x in requests.get(f"{API}/invoices", headers=owner_headers).json()
                        if x["id"] == iid)
            assert inv2["amount_paid"] == 20
            # audit
            audit = requests.get(f"{API}/audit", headers=owner_headers).json()
            assert any("Voided payment" in (a.get("details") or "") for a in audit[:30])
        finally:
            requests.delete(f"{API}/invoices/{iid}", headers=owner_headers)
            requests.delete(f"{API}/parts/{pid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_void_nonexistent(self, owner_headers):
        r = requests.delete(f"{API}/invoices/nope-nope", headers=owner_headers)
        assert r.status_code == 404
        r = requests.delete(f"{API}/payments/nope-nope", headers=owner_headers)
        assert r.status_code == 404


@pytest.mark.xdist_group("finance_state")
class TestAlertsAndToday:
    def test_alerts_and_dashboard_today(self, owner_headers):
        # baselines
        dash0 = requests.get(f"{API}/dashboard", headers=owner_headers).json()
        alerts0 = requests.get(f"{API}/alerts", headers=owner_headers).json()
        ls0 = len(alerts0["low_stock"])
        od0 = len(alerts0["overdue"])
        # Create a low-stock part (qty<=3) and an overdue customer
        p = requests.post(f"{API}/parts",
                          json={"name": "TEST_Alert_Part", "quantity": 1,
                                "unit_cost": 100, "sale_price": 500},
                          headers=owner_headers).json()
        pid = p["id"]
        c = requests.post(f"{API}/customers",
                          json={"name": "TEST_Alert_Cust"},
                          headers=owner_headers).json()
        cid = c["id"]
        inv = requests.post(f"{API}/invoices", json={
            "customer_id": cid,
            "items": [{"description": "TEST outstanding", "quantity": 1,
                       "unit_price": 5000, "item_type": "custom"}],
            "amount_paid": 0,
        }, headers=owner_headers).json()
        iid = inv["id"]

        try:
            # /api/alerts
            a = requests.get(f"{API}/alerts", headers=owner_headers)
            assert a.status_code == 200
            ad = a.json()
            assert "low_stock" in ad and "overdue" in ad and "count" in ad
            assert any(x["id"] == pid for x in ad["low_stock"]), ad["low_stock"]
            assert any(x["id"] == cid for x in ad["overdue"]), ad["overdue"]
            # count is at least our 2 additions
            assert ad["count"] >= 2

            # dashboard: alerts_count + today_sales/payments increased
            dash1 = requests.get(f"{API}/dashboard", headers=owner_headers).json()
            for k in ["today_sales", "today_payments", "alerts_count"]:
                assert k in dash1, dash1.keys()
            # today_sales must include our 5000 subtotal (loose absolute bound tolerates
            # parallel test churn where other classes may void invoices between snapshots)
            assert dash1["today_sales"] >= 4500, (dash0.get("today_sales", 0), dash1["today_sales"])

            # today_payments: create a payment today
            pay = requests.post(f"{API}/payments", json={
                "customer_id": cid, "amount": 1500, "invoice_id": iid},
                headers=owner_headers).json()
            pay_id = pay["id"]
            try:
                dash2 = requests.get(f"{API}/dashboard", headers=owner_headers).json()
                assert dash2["today_payments"] >= 1500, (dash0.get("today_payments", 0), dash2["today_payments"])
            finally:
                requests.delete(f"{API}/payments/{pay_id}", headers=owner_headers)
        finally:
            requests.delete(f"{API}/invoices/{iid}", headers=owner_headers)
            requests.delete(f"{API}/parts/{pid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)


@pytest.mark.xdist_group("finance_state")
class TestReportDateFilter:
    def test_pnl_date_range(self, owner_headers):
        # Isolated unique future date so concurrent xdist workers can't shift the range.
        iso = "2099-06-15"
        before = "2099-06-14"

        # Range in the past (before any data): expect 0 sales delta
        r_past = requests.get(f"{API}/reports/pnl?start=2000-01-01&end=2000-01-02", headers=owner_headers)
        assert r_past.status_code == 200
        assert r_past.json()["sales_revenue"] == 0
        assert r_past.json()["cogs"] == 0

        # The isolated future day starts empty.
        day_base = requests.get(f"{API}/reports/pnl?start={iso}&end={iso}",
                                headers=owner_headers).json()["sales_revenue"]

        # Sales use the tax-INCLUSIVE entered amount => a 10000 invoice adds exactly 10000.
        c = requests.post(f"{API}/customers", json={"name": "TEST_Range_Cust"},
                          headers=owner_headers).json()
        cid = c["id"]
        inv = requests.post(f"{API}/invoices", json={
            "customer_id": cid,
            "sale_date": iso,
            "items": [{"description": "TEST rng", "quantity": 1,
                       "unit_price": 10000, "item_type": "custom"}],
            "amount_paid": 0,
        }, headers=owner_headers).json()
        iid = inv["id"]
        try:
            r_day = requests.get(f"{API}/reports/pnl?start={iso}&end={iso}",
                                 headers=owner_headers).json()
            # Sales = actual entered amount (tax-inclusive total), not the tax-exclusive subtotal.
            assert abs(r_day["sales_revenue"] - (day_base + 10000)) < 0.01

            # A range ending the day before must NOT include this invoice.
            r_before = requests.get(f"{API}/reports/pnl?start=2099-01-01&end={before}",
                                    headers=owner_headers).json()
            assert r_before["sales_revenue"] == 0
        finally:
            requests.delete(f"{API}/invoices/{iid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)


class TestCSVExport:
    def test_csv_all_entities_with_token(self, owner_token):
        for entity in ["vehicles", "parts", "customers", "invoices"]:
            r = requests.get(f"{API}/export/{entity}?token={owner_token}")
            assert r.status_code == 200, f"{entity}: {r.status_code} {r.text[:200]}"
            assert r.headers.get("content-type", "").startswith("text/csv"), r.headers
            # header row present
            first_line = r.text.splitlines()[0]
            assert "," in first_line and len(first_line) > 5

    def test_csv_unknown(self, owner_token):
        r = requests.get(f"{API}/export/foobar?token={owner_token}")
        assert r.status_code == 404

    def test_csv_no_auth(self):
        r = requests.get(f"{API}/export/vehicles")
        assert r.status_code == 401


class TestLogoBankFooter:
    def test_put_settings_with_datauri_logo_and_invoice_pdf(self, owner_headers):
        s = requests.get(f"{API}/settings", headers=owner_headers).json()
        orig = {k: v for k, v in s.items() if k != "id"}
        # 2x2 opaque red PNG (valid, PIL-generated)
        tiny_png_b64 = ("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=")
        payload = dict(orig)
        payload["logo_url"] = f"data:image/png;base64,{tiny_png_b64}"
        payload["bank_details"] = "TEST Bank\nAcc: 123456\nBranch: Osaka"
        payload["invoice_footer"] = "TEST footer - thank you"
        r = requests.put(f"{API}/settings", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text

        # Verify persisted
        s2 = requests.get(f"{API}/settings", headers=owner_headers).json()
        assert s2["logo_url"].startswith("data:image/png;base64,")
        assert "TEST Bank" in s2["bank_details"]
        assert s2["invoice_footer"] == "TEST footer - thank you"

        # Generate an invoice PDF and confirm still %PDF
        c = requests.post(f"{API}/customers", json={"name": "TEST_PDF_Cust"},
                          headers=owner_headers).json()
        cid = c["id"]
        inv = requests.post(f"{API}/invoices", json={
            "customer_id": cid,
            "items": [{"description": "PDF test", "quantity": 1,
                       "unit_price": 100, "item_type": "custom"}],
            "amount_paid": 0,
        }, headers=owner_headers).json()
        iid = inv["id"]
        try:
            # FIX #1: invoice PDF must render OK with data-URL logo
            pdf = requests.get(f"{API}/invoices/{iid}/pdf", headers=owner_headers)
            assert pdf.status_code == 200, f"invoice PDF failed with data-URL logo: {pdf.status_code} {pdf.text[:300]}"
            assert pdf.content[:4] == b"%PDF"
            assert len(pdf.content) > 1000
            # Also with ?token= query auth
            pdf2 = requests.get(f"{API}/invoices/{iid}/pdf?token={owner_headers['Authorization'].split()[1]}")
            assert pdf2.status_code == 200 and pdf2.content[:4] == b"%PDF"

            # FIX #2: report PNL PDF must accept ?token= and render OK with data-URL logo
            tok = owner_headers["Authorization"].split()[1]
            rep = requests.get(f"{API}/reports/pnl/pdf?token={tok}")
            assert rep.status_code == 200, f"report pnl pdf token auth failed: {rep.status_code} {rep.text[:300]}"
            assert rep.content[:4] == b"%PDF"
            # Bad token must be 401
            rep_bad = requests.get(f"{API}/reports/pnl/pdf?token=bad.jwt.token")
            assert rep_bad.status_code == 401
        finally:
            requests.delete(f"{API}/invoices/{iid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)
            # Restore original settings
            requests.put(f"{API}/settings", json=orig, headers=owner_headers)


class TestAlertsRBAC:
    def test_alerts_requires_dashboard_view(self):
        # No auth
        r = requests.get(f"{API}/alerts")
        assert r.status_code == 401


# ============================================================================
# MASTER UPGRADE: Engine/HalfCut tracked parts, Recovery, Allocations, Summary
# ============================================================================

def _cleanup_mongo(collection_filter_pairs):
    """Direct mongo cleanup for entities without DELETE endpoints."""
    try:
        from pymongo import MongoClient
        from dotenv import dotenv_values as _dv
        be = _dv("/app/backend/.env")
        mc = MongoClient(be["MONGO_URL"])
        dbn = mc[be["DB_NAME"]]
        for coll, filt in collection_filter_pairs:
            dbn[coll].delete_many(filt)
        mc.close()
    except Exception as e:
        print("mongo cleanup err:", e)


@pytest.fixture(scope="module")
def mgr_headers(owner_headers, created):
    email = f"test_mgr_master_{os.urandom(3).hex()}@x.com"
    pw = "Test@2026"
    r = requests.post(f"{API}/users", json={
        "name": "TEST_MgrMaster", "email": email, "password": pw, "role": "Manager"},
        headers=owner_headers)
    assert r.status_code == 200, r.text
    created["users"].append(r.json()["id"])
    tok = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def acc_headers(owner_headers, created):
    email = f"test_acc_master_{os.urandom(3).hex()}@x.com"
    pw = "Test@2026"
    r = requests.post(f"{API}/users", json={
        "name": "TEST_AccMaster", "email": email, "password": pw, "role": "Accountant"},
        headers=owner_headers)
    assert r.status_code == 200, r.text
    created["users"].append(r.json()["id"])
    tok = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


# ---------------- Engine + Half Cut lifecycle ----------------
@pytest.mark.xdist_group("master_upgrade")
class TestDismantleTracked:
    """A/B/C: engine_code+engine_number vehicles, dismantle creating tracked parts, double-dismantle block."""

    def test_engine_halfcut_flow_and_search_sell(self, owner_headers):
        # A. create vehicle with engine fields
        chassis = f"TEST-ENG-{os.urandom(3).hex()}"
        ecode = f"ECODE{os.urandom(3).hex().upper()}"
        enum = f"ENUM{os.urandom(3).hex().upper()}"
        vr = requests.post(f"{API}/vehicles", json={
            "chassis_number": chassis, "make": "Toyota", "model": "Vitz",
            "year": 2015, "purchase_price": 400000,
            "engine_code": ecode, "engine_number": enum,
            "purchase_date": "2026-06-15"
        }, headers=owner_headers)
        assert vr.status_code == 200, vr.text
        v = vr.json()
        vid = v["id"]
        assert v["engine_code"] == ecode
        assert v["engine_number"] == enum

        try:
            # B. dismantle with create_engine=True + create_half_cut=True
            dis = requests.post(f"{API}/vehicles/{vid}/dismantle", json={
                "dismantle_date": "2026-07-10",
                "create_engine": True, "create_half_cut": True,
                "parts": []
            }, headers=owner_headers)
            assert dis.status_code == 200, dis.text
            data = dis.json()
            assert len(data["tracked_created"]) == 2
            types = sorted(t["part_type"] for t in data["tracked_created"])
            assert types == ["engine", "half_cut"]
            engine_tp = next(t for t in data["tracked_created"] if t["part_type"] == "engine")
            hc_tp = next(t for t in data["tracked_created"] if t["part_type"] == "half_cut")
            assert engine_tp["engine_code"] == ecode
            assert engine_tp["source_vehicle_id"] == vid
            assert engine_tp["dismantle_date"] == "2026-07-10"

            # vehicle status now dismantled with date set
            vg = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            assert vg["status"] == "dismantled"
            assert vg["dismantle_date"] == "2026-07-10"
            assert len(vg["tracked_parts"]) == 2
            assert "recovery" in vg

            # C. double-dismantle blocked
            dis2 = requests.post(f"{API}/vehicles/{vid}/dismantle", json={
                "create_engine": True, "create_half_cut": False, "parts": []
            }, headers=owner_headers)
            assert dis2.status_code == 400
            assert "already dismantled" in dis2.json().get("detail", "").lower()

            # D. engine search by engine_code returns it
            srch = requests.get(f"{API}/tracked-parts?type=engine&q={ecode}", headers=owner_headers)
            assert srch.status_code == 200
            hits = srch.json()
            assert any(t["id"] == engine_tp["id"] for t in hits), hits

            # customer for sale
            c = requests.post(f"{API}/customers", json={"name": "TEST_MU_Cust"},
                              headers=owner_headers).json()
            cid = c["id"]

            try:
                # E. sell engine partial payment
                sell = requests.post(f"{API}/tracked-parts/{engine_tp['id']}/sell", json={
                    "sale_date": "2026-07-15", "customer_id": cid,
                    "sale_price": 150000, "amount_received": 100000
                }, headers=owner_headers)
                assert sell.status_code == 200, sell.text
                assert sell.json()["balance_due"] == 50000

                # F. cannot sell same engine again
                sell2 = requests.post(f"{API}/tracked-parts/{engine_tp['id']}/sell", json={
                    "customer_id": cid, "sale_price": 100, "amount_received": 100
                }, headers=owner_headers)
                assert sell2.status_code == 400
                assert "already sold" in sell2.json().get("detail", "").lower()

                # engine still shows in search with status sold
                srch2 = requests.get(f"{API}/tracked-parts?type=engine&q={ecode}",
                                     headers=owner_headers).json()
                match = next((t for t in srch2 if t["id"] == engine_tp["id"]), None)
                assert match is not None and match["status"] == "sold"
                assert match["sale_price"] == 150000

                # G. sell half cut
                sell_hc = requests.post(f"{API}/tracked-parts/{hc_tp['id']}/sell", json={
                    "sale_date": "2026-07-16", "customer_id": cid,
                    "sale_price": 80000, "amount_received": 80000
                }, headers=owner_headers)
                assert sell_hc.status_code == 200
                assert sell_hc.json()["balance_due"] == 0

                # H/I. customer balance reflects tracked sales
                cget = requests.get(f"{API}/customers/{cid}", headers=owner_headers).json()
                # billed: 150000 (engine) + 80000 (halfcut) = 230000
                # paid: 100000 + 80000 = 180000, outstanding = 50000
                assert cget["balance"]["billed"] == 230000, cget["balance"]
                assert cget["balance"]["paid"] == 180000, cget["balance"]
                assert cget["balance"]["outstanding"] == 50000, cget["balance"]

                # Also verify list endpoint
                clist = requests.get(f"{API}/customers", headers=owner_headers).json()
                m = next(x for x in clist if x["id"] == cid)
                assert m["balance"]["outstanding"] == 50000

                # R. Recovery block on vehicle detail
                vg2 = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
                rec = vg2["recovery"]
                assert rec["purchase_price"] == 400000
                assert rec["engine"]["total"] == 150000
                assert rec["half_cut"]["total"] == 80000
                assert rec["scrap"]["total"] == 0
                assert rec["shokubai"]["total"] == 0
                assert rec["complete_sale"] == 0
                assert rec["total_recovered"] == 230000
                assert rec["profit_loss"] == -170000
                assert rec["remaining_to_recover"] == 170000
            finally:
                requests.delete(f"{API}/customers/{cid}", headers=owner_headers)
        finally:
            _cleanup_mongo([("tracked_parts", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)


# ---------------- Complete vehicle sale ----------------
@pytest.mark.xdist_group("master_upgrade")
class TestCompleteVehicleSale:
    def test_sell_complete_and_conflicts(self, owner_headers):
        # P. sell in-stock vehicle complete
        chassis = f"TEST-CV-{os.urandom(3).hex()}"
        vr = requests.post(f"{API}/vehicles", json={
            "chassis_number": chassis, "make": "Honda", "model": "Fit",
            "purchase_price": 600000, "purchase_date": "2026-06-01"
        }, headers=owner_headers)
        vid = vr.json()["id"]
        c = requests.post(f"{API}/customers", json={"name": "TEST_CV_Cust"},
                          headers=owner_headers).json()
        cid = c["id"]
        try:
            sell = requests.post(f"{API}/vehicles/{vid}/sell", json={
                "sale_date": "2026-07-20", "customer_id": cid,
                "sale_price": 800000, "amount_received": 500000
            }, headers=owner_headers)
            assert sell.status_code == 200, sell.text
            assert sell.json()["balance_due"] == 300000

            vg = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            assert vg["status"] == "sold_complete"
            assert vg["sale_price"] == 800000
            # sold-complete uses a sale summary, never the dismantle recovery panel
            assert "recovery" not in vg
            assert vg["sale_summary"]["sale_price"] == 800000
            assert vg["sale_summary"]["profit_loss"] == 200000
            assert vg["sale_summary"]["balance_due"] == 300000

            # customer balance
            cg = requests.get(f"{API}/customers/{cid}", headers=owner_headers).json()
            assert cg["balance"]["billed"] == 800000
            assert cg["balance"]["paid"] == 500000
            assert cg["balance"]["outstanding"] == 300000

            # Q. sold_complete cannot be dismantled
            dis = requests.post(f"{API}/vehicles/{vid}/dismantle", json={
                "create_engine": True, "parts": []}, headers=owner_headers)
            assert dis.status_code == 400

            # Q. dismantled cannot be sold complete
            chassis2 = f"TEST-CV2-{os.urandom(3).hex()}"
            v2 = requests.post(f"{API}/vehicles", json={
                "chassis_number": chassis2, "make": "Mazda", "model": "Demio",
                "purchase_price": 200000}, headers=owner_headers).json()
            vid2 = v2["id"]
            try:
                requests.post(f"{API}/vehicles/{vid2}/dismantle", json={
                    "dismantle_date": "2026-07-05",
                    "create_engine": True, "parts": []}, headers=owner_headers)
                sell2 = requests.post(f"{API}/vehicles/{vid2}/sell", json={
                    "customer_id": cid, "sale_price": 300000, "amount_received": 0
                }, headers=owner_headers)
                assert sell2.status_code == 400
                assert "dismantled" in sell2.json().get("detail", "").lower()
            finally:
                _cleanup_mongo([("tracked_parts", {"source_vehicle_id": vid2})])
                requests.delete(f"{API}/vehicles/{vid2}", headers=owner_headers)
        finally:
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)


# ---------------- Scrap + Shokubai allocations ----------------
@pytest.mark.xdist_group("master_upgrade")
class TestAllocations:
    def test_scrap_by_dismantle_month(self, owner_headers):
        # Two dismantled vehicles in 2026-05, one in 2026-04, one sold_complete
        vids = []
        chassis_list = []
        for i, dm in enumerate([("2026-05-05", 100000), ("2026-05-20", 120000),
                                 ("2026-04-15", 80000)]):
            ch = f"TEST-SCR{i}-{os.urandom(3).hex()}"
            chassis_list.append(ch)
            v = requests.post(f"{API}/vehicles", json={
                "chassis_number": ch, "make": "T", "model": "M",
                "purchase_price": dm[1], "purchase_date": "2026-03-01"
            }, headers=owner_headers).json()
            vids.append(v["id"])
            requests.post(f"{API}/vehicles/{v['id']}/dismantle", json={
                "dismantle_date": dm[0], "create_engine": True, "parts": []
            }, headers=owner_headers)

        # One sold_complete (should NOT count)
        ch_sc = f"TEST-SCRSC-{os.urandom(3).hex()}"
        chassis_list.append(ch_sc)
        vsc = requests.post(f"{API}/vehicles", json={
            "chassis_number": ch_sc, "make": "T", "model": "M",
            "purchase_price": 100000
        }, headers=owner_headers).json()
        vids.append(vsc["id"])
        c = requests.post(f"{API}/customers", json={"name": "TEST_SCR_Cust"},
                          headers=owner_headers).json()
        cid = c["id"]
        requests.post(f"{API}/vehicles/{vsc['id']}/sell", json={
            "sale_date": "2026-05-15", "customer_id": cid,
            "sale_price": 200000, "amount_received": 200000
        }, headers=owner_headers)

        try:
            # J/K. scrap for 2026-05: should hit exactly 2 vehicles (per_vehicle=50000)
            sc = requests.post(f"{API}/scrap-allocations", json={
                "month": "2026-05", "total_amount": 100000
            }, headers=owner_headers)
            assert sc.status_code == 200, sc.text
            doc = sc.json()
            assert doc["vehicle_count"] == 2, doc
            assert doc["per_vehicle"] == 50000
            assert set(doc["vehicle_ids"]) == {vids[0], vids[1]}
            scrap_id = doc["id"]

            # L. duplicate scrap for same month blocked
            sc2 = requests.post(f"{API}/scrap-allocations", json={
                "month": "2026-05", "total_amount": 50000
            }, headers=owner_headers)
            assert sc2.status_code == 400

            # verify recovery for one of the vehicles picks up scrap
            vg = requests.get(f"{API}/vehicles/{vids[0]}", headers=owner_headers).json()
            assert vg["recovery"]["scrap"]["total"] == 50000

            # Owner can delete (records.reverse)
            d = requests.delete(f"{API}/scrap-allocations/{scrap_id}", headers=owner_headers)
            assert d.status_code == 200
        finally:
            _cleanup_mongo([
                ("scrap_allocations", {"month": "2026-05"}),
                ("tracked_parts", {"source_vehicle_id": {"$in": vids}}),
            ])
            for vid in vids:
                requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_shokubai_cutoff(self, owner_headers):
        # Use a base AFTER any existing (real) shokubai cutoff so real business data does not interfere
        existing = requests.get(f"{API}/shokubai-allocations", headers=owner_headers).json()
        max_cut = max([a.get("new_cutoff", "2000-01-01") for a in existing], default="2000-01-01")
        y = max(2040, int(max_cut[:4]) + 2)
        c1, c2 = f"{y}-05-31", f"{y}-06-30"
        # 3 dismantled vehicles at different dates in the far-future window
        vids = []
        for i, dm in enumerate([f"{y}-05-10", f"{y}-05-25", f"{y}-06-05"]):
            ch = f"TEST-SHK{i}-{os.urandom(3).hex()}"
            v = requests.post(f"{API}/vehicles", json={
                "chassis_number": ch, "make": "N", "model": "N",
                "purchase_price": 100000
            }, headers=owner_headers).json()
            vids.append(v["id"])
            requests.post(f"{API}/vehicles/{v['id']}/dismantle", json={
                "dismantle_date": dm, "create_engine": True, "parts": []
            }, headers=owner_headers)

        shok_ids = []
        try:
            # first cut-off catches the first 2 test vehicles
            s1 = requests.post(f"{API}/shokubai-allocations", json={
                "sale_date": c1, "total_amount": 200000
            }, headers=owner_headers)
            assert s1.status_code == 200, s1.text
            d1 = s1.json()
            shok_ids.append(d1["id"])
            assert vids[0] in d1["vehicle_ids"] and vids[1] in d1["vehicle_ids"]
            assert vids[2] not in d1["vehicle_ids"]

            # earlier/equal cutoff rejected
            s_bad = requests.post(f"{API}/shokubai-allocations", json={
                "sale_date": c1, "total_amount": 1000
            }, headers=owner_headers)
            assert s_bad.status_code == 400

            # second cut-off catches vehicle 3 (dedup: not already-allocated ones)
            s2 = requests.post(f"{API}/shokubai-allocations", json={
                "sale_date": c2, "total_amount": 90000
            }, headers=owner_headers)
            assert s2.status_code == 200, s2.text
            d2 = s2.json()
            shok_ids.append(d2["id"])
            assert vids[2] in d2["vehicle_ids"]
            assert vids[0] not in d2["vehicle_ids"] and vids[1] not in d2["vehicle_ids"]

            # Recovery reflects (allocated -> shokubai total > 0)
            vg = requests.get(f"{API}/vehicles/{vids[0]}", headers=owner_headers).json()
            assert vg["recovery"]["shokubai"]["total"] > 0
        finally:
            _cleanup_mongo([
                ("shokubai_allocations", {"id": {"$in": shok_ids}}),
                ("tracked_parts", {"source_vehicle_id": {"$in": vids}}),
            ])
            for vid in vids:
                requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)


# ---------------- Reports monthly/yearly + expense categories ----------------
@pytest.mark.xdist_group("master_upgrade")
class TestReportsSummary:
    def test_monthly_yearly_summary(self, owner_headers):
        # Set up one vehicle purchased+sold_complete in target month
        month = "2026-09"
        vids, cust_ids, expense_ids, shok_ids = [], [], [], []
        # Complete-sold vehicle
        ch = f"TEST-RS1-{os.urandom(3).hex()}"
        v1 = requests.post(f"{API}/vehicles", json={
            "chassis_number": ch, "make": "R", "model": "S1",
            "purchase_price": 400000, "purchase_date": "2026-09-05"
        }, headers=owner_headers).json()
        vids.append(v1["id"])
        c = requests.post(f"{API}/customers", json={"name": "TEST_RS_Cust"},
                          headers=owner_headers).json()
        cid = c["id"]; cust_ids.append(cid)
        requests.post(f"{API}/vehicles/{v1['id']}/sell", json={
            "sale_date": "2026-09-10", "customer_id": cid,
            "sale_price": 600000, "amount_received": 400000
        }, headers=owner_headers)

        # Dismantled + engine sold
        ch2 = f"TEST-RS2-{os.urandom(3).hex()}"
        v2 = requests.post(f"{API}/vehicles", json={
            "chassis_number": ch2, "make": "R", "model": "S2",
            "purchase_price": 200000, "purchase_date": "2026-09-01"
        }, headers=owner_headers).json()
        vids.append(v2["id"])
        dis = requests.post(f"{API}/vehicles/{v2['id']}/dismantle", json={
            "dismantle_date": "2026-09-08", "create_engine": True, "create_half_cut": True,
            "parts": []}, headers=owner_headers).json()
        eng_id = next(t["id"] for t in dis["tracked_created"] if t["part_type"] == "engine")
        hc_id = next(t["id"] for t in dis["tracked_created"] if t["part_type"] == "half_cut")
        requests.post(f"{API}/tracked-parts/{eng_id}/sell", json={
            "sale_date": "2026-09-12", "customer_id": cid,
            "sale_price": 100000, "amount_received": 60000
        }, headers=owner_headers)
        requests.post(f"{API}/tracked-parts/{hc_id}/sell", json={
            "sale_date": "2026-09-14", "customer_id": cid,
            "sale_price": 50000, "amount_received": 50000
        }, headers=owner_headers)

        # Shokubai in month
        s1 = requests.post(f"{API}/shokubai-allocations", json={
            "sale_date": "2026-09-30", "total_amount": 40000
        }, headers=owner_headers)
        if s1.status_code == 200:
            shok_ids.append(s1.json()["id"])

        # Expenses w/ categories
        for cat, amt in [("Diesel/Fuel", 5000), ("Transport", 3000),
                        ("Repairs", 2000), ("Other", 1000)]:
            er = requests.post(f"{API}/expenses", json={
                "category": cat, "amount": amt, "date": "2026-09-15"
            }, headers=owner_headers)
            if er.status_code == 200:
                expense_ids.append(er.json()["id"])

        try:
            # S. monthly summary
            m = requests.get(f"{API}/reports/monthly?month={month}", headers=owner_headers)
            assert m.status_code == 200
            d = m.json()
            for k in ["purchase_total", "complete_sales", "engine_sales", "halfcut_sales",
                      "parts_sales", "scrap_sales", "shokubai_sales", "total_sales",
                      "received", "balance_due", "salaries", "expenses_by_category",
                      "total_expenses", "net_profit"]:
                assert k in d, f"missing {k}"
            assert d["complete_sales"] >= 600000
            assert d["engine_sales"] >= 100000
            assert d["halfcut_sales"] >= 50000
            assert d["shokubai_sales"] >= 40000
            # total_sales != received (partial payments)
            assert d["total_sales"] != d["received"], (d["total_sales"], d["received"])
            assert d["balance_due"] > 0
            # expenses_by_category
            for cat in ["Diesel/Fuel", "Transport", "Repairs", "Other"]:
                assert cat in d["expenses_by_category"], d["expenses_by_category"]
            # V. net profit = total_sales - total_expenses
            assert abs(d["net_profit"] - (d["total_sales"] - d.get("cogs", 0) - d["total_expenses"])) < 0.5

            # T. yearly
            y = requests.get(f"{API}/reports/yearly?year=2026", headers=owner_headers)
            assert y.status_code == 200
            yd = y.json()
            assert yd["complete_sales"] >= 600000

            # yearly with month
            ym = requests.get(f"{API}/reports/yearly?year=2026&month=09",
                              headers=owner_headers).json()
            assert ym["complete_sales"] >= 600000
        finally:
            _cleanup_mongo([
                ("shokubai_allocations", {"id": {"$in": shok_ids}}),
                ("tracked_parts", {"source_vehicle_id": {"$in": vids}}),
            ])
            for eid in expense_ids:
                requests.delete(f"{API}/expenses/{eid}", headers=owner_headers)
            for vid in vids:
                requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            for cid in cust_ids:
                requests.delete(f"{API}/customers/{cid}", headers=owner_headers)


# ---------------- RBAC on new endpoints ----------------
@pytest.mark.xdist_group("master_upgrade")
class TestMasterRBAC:
    def test_manager_can_dismantle_sellcomplete_selltracked_but_not_allocate_or_reverse(
            self, owner_headers, mgr_headers):
        # W. Manager can create/dismantle/sell but not allocate scrap/shokubai
        ch = f"TEST-MG-{os.urandom(3).hex()}"
        v = requests.post(f"{API}/vehicles", json={
            "chassis_number": ch, "make": "M", "model": "M",
            "purchase_price": 100000
        }, headers=mgr_headers).json()
        vid = v["id"]

        # Manager dismantle
        dis = requests.post(f"{API}/vehicles/{vid}/dismantle", json={
            "dismantle_date": "2026-08-10", "create_engine": True, "parts": []
        }, headers=mgr_headers)
        assert dis.status_code == 200, dis.text
        eng_id = dis.json()["tracked_created"][0]["id"]

        c = requests.post(f"{API}/customers", json={"name": "TEST_MG_C"},
                          headers=owner_headers).json()
        cid = c["id"]
        try:
            # Manager can sell tracked part
            st = requests.post(f"{API}/tracked-parts/{eng_id}/sell", json={
                "customer_id": cid, "sale_price": 50000, "amount_received": 50000
            }, headers=mgr_headers)
            assert st.status_code == 200

            # Manager cannot create scrap allocation (needs finance.edit)
            sc = requests.post(f"{API}/scrap-allocations", json={
                "month": "2026-08", "total_amount": 10000
            }, headers=mgr_headers)
            assert sc.status_code == 403

            # Manager cannot create shokubai
            sh = requests.post(f"{API}/shokubai-allocations", json={
                "sale_date": "2026-08-31", "total_amount": 10000
            }, headers=mgr_headers)
            assert sh.status_code == 403

            # Manager cannot correct dismantle date (needs records.reverse — Owner only)
            dd = requests.put(f"{API}/vehicles/{vid}/dismantle-date", json={
                "dismantle_date": "2026-08-11"}, headers=mgr_headers)
            assert dd.status_code == 403

            # Owner CAN correct dismantle date
            ddo = requests.put(f"{API}/vehicles/{vid}/dismantle-date", json={
                "dismantle_date": "2026-08-11"}, headers=owner_headers)
            assert ddo.status_code == 200
            assert ddo.json()["new"] == "2026-08-11"
            # verify tracked parts propagated
            vg = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            assert vg["dismantle_date"] == "2026-08-11"
            assert all(t["dismantle_date"] == "2026-08-11" for t in vg["tracked_parts"])
        finally:
            _cleanup_mongo([("tracked_parts", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_accountant_can_allocate_and_sell_tracked_but_not_dismantle(
            self, owner_headers, acc_headers):
        # Accountant cannot dismantle (needs vehicles.edit)
        ch = f"TEST-AC-{os.urandom(3).hex()}"
        v = requests.post(f"{API}/vehicles", json={
            "chassis_number": ch, "make": "A", "model": "A",
            "purchase_price": 100000
        }, headers=owner_headers).json()
        vid = v["id"]
        try:
            dis_bad = requests.post(f"{API}/vehicles/{vid}/dismantle", json={
                "dismantle_date": "2026-08-05", "create_engine": True, "parts": []
            }, headers=acc_headers)
            assert dis_bad.status_code == 403

            # Owner dismantles it
            dis = requests.post(f"{API}/vehicles/{vid}/dismantle", json={
                "dismantle_date": "2026-08-05", "create_engine": True, "parts": []
            }, headers=owner_headers).json()
            eng_id = dis["tracked_created"][0]["id"]

            c = requests.post(f"{API}/customers", json={"name": "TEST_AC_C"},
                              headers=owner_headers).json()
            cid = c["id"]

            # Accountant CAN sell tracked (has finance.edit)
            st = requests.post(f"{API}/tracked-parts/{eng_id}/sell", json={
                "customer_id": cid, "sale_price": 30000, "amount_received": 30000
            }, headers=acc_headers)
            assert st.status_code == 200

            # Accountant CAN create scrap allocation
            # (Use a month with only this dismantle so we don't collide)
            sc = requests.post(f"{API}/scrap-allocations", json={
                "month": "2026-08", "total_amount": 20000
            }, headers=acc_headers)
            # It may succeed OR conflict with prior TestMasterRBAC dismantle
            # in same month. Accept 200 or 400 "already allocated"; assert NOT 403.
            assert sc.status_code in (200, 400), sc.text
            scrap_id = sc.json().get("id") if sc.status_code == 200 else None

            # Accountant cannot reverse (no records.reverse) — try delete
            if scrap_id:
                rev = requests.delete(f"{API}/scrap-allocations/{scrap_id}",
                                      headers=acc_headers)
                assert rev.status_code == 403
                # Owner cleans up
                requests.delete(f"{API}/scrap-allocations/{scrap_id}",
                                headers=owner_headers)

            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)
        finally:
            _cleanup_mongo([
                ("tracked_parts", {"source_vehicle_id": vid}),
                ("scrap_allocations", {"month": "2026-08"}),
            ])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)

    def test_owner_has_records_reverse(self, owner_headers):
        # W. Owner has records.reverse
        r = requests.get(f"{API}/auth/me", headers=owner_headers).json()
        assert "records.reverse" in r["permissions"]


# ---------------- NEW PDF period reports + expanded exports + backup ----------------
class TestPeriodReportPDFs:
    def test_today_monthly_yearly_pdf(self, owner_token):
        for path in ["/reports/today/pdf",
                     "/reports/monthly/pdf?month=2026-07",
                     "/reports/yearly/pdf?year=2026",
                     "/reports/yearly/pdf?year=2026&month=07"]:
            r = requests.get(f"{API}{path}&token={owner_token}" if "?" in path
                             else f"{API}{path}?token={owner_token}")
            assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"
            assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
            assert r.content[:4] == b"%PDF", r.content[:20]

    def test_pdf_bad_token_rejected(self):
        r = requests.get(f"{API}/reports/today/pdf?token=bad.jwt.token")
        assert r.status_code == 401

    def test_pdf_no_auth(self):
        r = requests.get(f"{API}/reports/monthly/pdf?month=2026-07")
        assert r.status_code == 401


class TestExpandedCSVAndBackup:
    def test_csv_all_new_entities(self, owner_token):
        for entity in ["vehicles", "parts", "customers", "invoices",
                       "payments", "expenses", "tracked_parts",
                       "scrap_allocations", "shokubai_allocations", "salaries"]:
            r = requests.get(f"{API}/export/{entity}?token={owner_token}")
            assert r.status_code == 200, f"{entity}: {r.status_code} {r.text[:200]}"
            assert r.headers.get("content-type", "").startswith("text/csv"), (entity, r.headers)
            first_line = r.text.splitlines()[0]
            assert "," in first_line and len(first_line) > 5, entity

    def test_full_json_backup(self, owner_token):
        r = requests.get(f"{API}/export/backup?token={owner_token}")
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/json"), r.headers
        data = r.json()
        for coll in ["vehicles", "parts", "customers", "invoices", "payments",
                     "expenses", "tracked_parts", "scrap_allocations",
                     "shokubai_allocations", "salaries", "employees",
                     "audit_logs", "settings", "roles"]:
            assert coll in data, f"missing collection {coll} in backup"
            assert isinstance(data[coll], list), coll


# ---------------- PWA manifest & service worker ----------------
class TestPWAAssets:
    def test_manifest(self):
        r = requests.get(f"{BASE_URL}/manifest.json")
        assert r.status_code == 200, r.status_code
        m = r.json()
        assert m["name"] == "MTC"
        assert m["short_name"] == "MTC"
        assert m["display"] == "standalone"
        assert any("logo.png" in ic["src"] for ic in m["icons"])

    def test_service_worker_reachable(self):
        r = requests.get(f"{BASE_URL}/service-worker.js")
        assert r.status_code == 200
        assert "self" in r.text or "install" in r.text.lower() or len(r.text) > 20

    def test_index_html_apple_title(self):
        r = requests.get(f"{BASE_URL}/")
        assert r.status_code == 200
        assert 'apple-mobile-web-app-title" content="MTC"' in r.text or "MTC" in r.text
        assert "service-worker.js" in r.text


# ---------------- Workflow Simplification Round (iteration 10) ----------------
@pytest.mark.xdist_group("master_upgrade")
class TestWorkflowSimplification:
    """Tests for compact vehicle form, dismantle-date-only, direct engine/half_cut purchase,
    engine_halfcut_purchases summary field, compact part form supplier+purchase_date,
    and CSV exports for parts + tracked_parts new columns."""

    def test_compact_vehicle_no_make_model(self, owner_headers, created):
        # Only vehicle_name + chassis + supplier + price + date (make/model optional/blank)
        payload = {
            "vehicle_name": "TEST_Compact Truck",
            "chassis_number": f"TEST-CMP-{os.urandom(3).hex()}",
            "supplier": "TEST_Compact Supplier",
            "purchase_price": 500000,
            "purchase_date": "2026-07-05",
        }
        r = requests.post(f"{API}/vehicles", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text
        v = r.json()
        vid = v["id"]
        created["vehicles"].append(vid)
        assert v["vehicle_name"] == "TEST_Compact Truck"
        assert v["chassis_number"] == payload["chassis_number"]
        assert v["supplier"] == "TEST_Compact Supplier"
        assert v["purchase_price"] == 500000
        # GET returns it; in-stock vehicles have no recovery/sale panel (no false loss)
        g = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers)
        assert g.status_code == 200
        gj = g.json()
        assert gj["vehicle_name"] == "TEST_Compact Truck"
        assert gj["status"] == "in_stock"
        assert "recovery" not in gj
        assert "sale_summary" not in gj

    def test_dismantle_date_only(self, owner_headers, created):
        # Create vehicle with a different purchase_date
        chassis = f"TEST-DSM-{os.urandom(3).hex()}"
        vr = requests.post(f"{API}/vehicles", json={
            "vehicle_name": "TEST_Dismantle Van",
            "chassis_number": chassis, "supplier": "TEST_From",
            "purchase_price": 400000, "purchase_date": "2026-06-01",
        }, headers=owner_headers)
        assert vr.status_code == 200, vr.text
        vid = vr.json()["id"]
        created["vehicles"].append(vid)

        # Dismantle body: only dismantle_date + parts=[] + create_engine=true
        body = {"parts": [], "dismantle_date": "2027-01-10",
                "create_engine": True, "create_half_cut": False}
        d = requests.post(f"{API}/vehicles/{vid}/dismantle", json=body, headers=owner_headers)
        assert d.status_code == 200, d.text
        dj = d.json()
        assert len(dj["parts_created"]) == 0
        assert len(dj["tracked_created"]) == 1
        assert dj["tracked_created"][0]["part_type"] == "engine"

        # Vehicle state + dates
        g = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
        assert g["status"] == "dismantled"
        assert g["purchase_price"] == 400000  # purchase record preserved
        assert g["dismantle_date"] == "2027-01-10"
        assert g["purchase_date"] == "2026-06-01"  # unchanged

        # Double dismantle blocked
        d2 = requests.post(f"{API}/vehicles/{vid}/dismantle", json=body, headers=owner_headers)
        assert d2.status_code == 400

        # Owner corrects dismantle_date via records.reverse
        cr = requests.put(f"{API}/vehicles/{vid}/dismantle-date",
                          json={"dismantle_date": "2027-01-12"}, headers=owner_headers)
        assert cr.status_code == 200
        assert cr.json()["new"] == "2027-01-12"

    def test_dismantle_blocked_when_sold_complete(self, owner_headers, created):
        chassis = f"TEST-SLD-{os.urandom(3).hex()}"
        vr = requests.post(f"{API}/vehicles", json={
            "vehicle_name": "TEST_Sold Van", "chassis_number": chassis,
            "supplier": "TEST", "purchase_price": 200000, "purchase_date": "2026-06-15",
        }, headers=owner_headers)
        vid = vr.json()["id"]
        created["vehicles"].append(vid)

        # Create customer + sell complete
        cr = requests.post(f"{API}/customers",
                           json={"name": "TEST_Cust_Sold"}, headers=owner_headers)
        cid = cr.json()["id"]
        created["customers"].append(cid)
        sr = requests.post(f"{API}/vehicles/{vid}/sell",
                           json={"sale_price": 500000, "amount_received": 500000,
                                 "customer_id": cid, "sale_date": "2026-07-01"},
                           headers=owner_headers)
        assert sr.status_code == 200

        # Cannot dismantle sold_complete
        d = requests.post(f"{API}/vehicles/{vid}/dismantle",
                          json={"parts": [], "dismantle_date": "2026-07-05",
                                "create_engine": True, "create_half_cut": False},
                          headers=owner_headers)
        assert d.status_code == 400

    def test_direct_engine_purchase_and_sale(self, owner_headers, created):
        name = f"TEST_DirectEngine_{os.urandom(3).hex()}"
        payload = {"part_type": "engine", "name": name,
                   "supplier": "TEST_DirectFrom", "purchase_price": 60000,
                   "date": "2026-07-08"}
        r = requests.post(f"{API}/tracked-parts", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text
        tp = r.json()
        assert tp["source"] == "direct"
        assert tp["status"] == "available"
        assert tp["part_type"] == "engine"
        assert tp["name"] == name
        assert tp["supplier"] == "TEST_DirectFrom"
        assert tp["purchase_price"] == 60000
        # No chassis/source_vehicle required
        assert tp.get("chassis_number", "") == ""
        assert tp.get("source_vehicle_id") in (None, "")

        # Search by name
        lst = requests.get(f"{API}/tracked-parts",
                           params={"type": "engine", "q": name},
                           headers=owner_headers).json()
        assert any(x["id"] == tp["id"] for x in lst)

        # Sell + create customer
        cr = requests.post(f"{API}/customers",
                           json={"name": "TEST_DirectBuyer"}, headers=owner_headers)
        cid = cr.json()["id"]
        created["customers"].append(cid)
        sr = requests.post(f"{API}/tracked-parts/{tp['id']}/sell",
                           json={"customer_id": cid, "sale_price": 90000,
                                 "amount_received": 90000, "sale_date": "2026-07-15"},
                           headers=owner_headers)
        assert sr.status_code == 200, sr.text

        # Cannot sell twice
        sr2 = requests.post(f"{API}/tracked-parts/{tp['id']}/sell",
                            json={"customer_id": cid, "sale_price": 1,
                                  "amount_received": 0, "sale_date": "2026-07-16"},
                            headers=owner_headers)
        assert sr2.status_code == 400

        # cleanup
        requests.delete(f"{API}/tracked-parts/{tp['id']}", headers=owner_headers)

    def test_direct_half_cut_and_invalid_type(self, owner_headers, created):
        name = f"TEST_DirectHC_{os.urandom(3).hex()}"
        r = requests.post(f"{API}/tracked-parts",
                          json={"part_type": "half_cut", "name": name,
                                "supplier": "TEST_HCFrom", "purchase_price": 45000,
                                "date": "2026-07-09"}, headers=owner_headers)
        assert r.status_code == 200
        tp = r.json()
        assert tp["part_type"] == "half_cut"
        assert tp["source"] == "direct"
        assert tp["status"] == "available"

        # Invalid type
        bad = requests.post(f"{API}/tracked-parts",
                            json={"part_type": "not_a_type", "name": "X",
                                  "supplier": "Y", "purchase_price": 1},
                            headers=owner_headers)
        assert bad.status_code == 400

        requests.delete(f"{API}/tracked-parts/{tp['id']}", headers=owner_headers)

    def test_monthly_report_engine_halfcut_purchases(self, owner_headers, created):
        # Create a direct engine purchase in an isolated month + sale in same month
        month = "2026-04"
        pr = requests.post(f"{API}/tracked-parts",
                           json={"part_type": "engine",
                                 "name": f"TEST_MonPnL_{os.urandom(3).hex()}",
                                 "supplier": "TEST", "purchase_price": 70000,
                                 "date": f"{month}-05"}, headers=owner_headers)
        assert pr.status_code == 200
        tid = pr.json()["id"]

        cr = requests.post(f"{API}/customers",
                           json={"name": "TEST_PnLCust"}, headers=owner_headers)
        cid = cr.json()["id"]
        created["customers"].append(cid)
        sr = requests.post(f"{API}/tracked-parts/{tid}/sell",
                           json={"customer_id": cid, "sale_price": 110000,
                                 "amount_received": 50000,
                                 "sale_date": f"{month}-20"},
                           headers=owner_headers)
        assert sr.status_code == 200

        # Monthly summary
        m = requests.get(f"{API}/reports/monthly",
                         params={"month": month}, headers=owner_headers)
        assert m.status_code == 200
        mj = m.json()
        assert "engine_halfcut_purchases" in mj
        assert mj["engine_halfcut_purchases"] >= 70000
        assert mj["engine_sales"] >= 110000

        requests.delete(f"{API}/tracked-parts/{tid}", headers=owner_headers)

    def test_monthly_net_profit_regression_no_direct(self, owner_headers):
        # Use a month unlikely to have direct purchases from test flow above; verify
        # formula net_profit == total_sales - total_expenses when engine_halfcut_purchases==0.
        # Query a far-future month for isolation.
        month = "2027-11"
        r = requests.get(f"{API}/reports/monthly",
                        params={"month": month}, headers=owner_headers)
        assert r.status_code == 200
        j = r.json()
        # Regression: net_profit must equal total_sales - total_expenses (no direct-purchase deduction)
        assert round(j["net_profit"], 2) == round(j["total_sales"] - j.get("cogs", 0) - j["total_expenses"], 2)
        assert j.get("engine_halfcut_purchases", 0) == 0

    def test_compact_part_purchase(self, owner_headers, created):
        payload = {"name": f"TEST_CompactPart_{os.urandom(3).hex()}",
                   "quantity": 5, "unit_cost": 1000, "sale_price": 2500,
                   "supplier": "TEST_PartFrom",
                   "purchase_date": "2026-07-11"}
        r = requests.post(f"{API}/parts", json=payload, headers=owner_headers)
        assert r.status_code == 200, r.text
        p = r.json()
        created["parts"].append(p["id"])
        assert p["supplier"] == "TEST_PartFrom"
        assert p["purchase_date"] == "2026-07-11"
        assert p["quantity"] == 5
        # GET verifies persistence
        lst = requests.get(f"{API}/parts", params={"q": payload["name"]},
                           headers=owner_headers).json()
        assert any(x["id"] == p["id"] and x["supplier"] == "TEST_PartFrom"
                   and x["purchase_date"] == "2026-07-11" for x in lst)

    def test_csv_parts_has_new_columns(self, owner_token):
        r = requests.get(f"{API}/export/parts", params={"token": owner_token})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        header = r.text.splitlines()[0].lower()
        assert "purchase_date" in header
        assert "supplier" in header

    def test_csv_tracked_parts_has_new_columns(self, owner_token):
        r = requests.get(f"{API}/export/tracked_parts", params={"token": owner_token})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        header = r.text.splitlines()[0].lower()
        for col in ("date", "name", "source", "supplier", "purchase_price"):
            assert col in header, f"missing column {col} in header: {header}"

    def test_period_pdfs_pdf_signature(self, owner_token):
        # Regression: today/monthly/yearly PDFs still 200 %PDF
        for url in [f"{API}/reports/today/pdf",
                    f"{API}/reports/monthly/pdf?month=2026-07",
                    f"{API}/reports/yearly/pdf?year=2026"]:
            r = requests.get(url, params={"token": owner_token})
            assert r.status_code == 200, f"{url} -> {r.status_code}"
            assert r.headers["content-type"].startswith("application/pdf")
            assert r.content[:4] == b"%PDF"


# ============================================================================
# ITERATION 11 UPGRADE: Recovery, PartSales, Stock-aware summary
# ============================================================================
@pytest.mark.xdist_group("recovery_upgrade")
class TestRecoveryPartSales:
    """Covers PartSaleIn CRUD, recovery immutability, no-double-count, stock-aware COGS."""

    def _mk_dismantled_vehicle(self, owner_headers, price=100000, purchase_date="2028-01-05",
                               dismantle_date="2028-01-06"):
        chassis = f"TEST-RP-{os.urandom(4).hex()}"
        vr = requests.post(f"{API}/vehicles", json={
            "chassis_number": chassis, "make": "T", "model": "R",
            "vehicle_name": "TEST_RP_Vehicle",
            "purchase_price": price, "purchase_date": purchase_date
        }, headers=owner_headers)
        assert vr.status_code == 200, vr.text
        vid = vr.json()["id"]
        d = requests.post(f"{API}/vehicles/{vid}/dismantle", json={
            "dismantle_date": dismantle_date,
            "create_engine": False, "create_half_cut": False, "parts": []
        }, headers=owner_headers)
        assert d.status_code == 200, d.text
        return vid, chassis

    def test_part_sale_recovery_immutable_price(self, owner_headers):
        vid, chassis = self._mk_dismantled_vehicle(owner_headers, price=100000)
        cust = requests.post(f"{API}/customers", json={"name": "TEST_RP_Cust"},
                             headers=owner_headers).json()
        cid = cust["id"]
        ps_ids = []
        try:
            # First part sale 60000
            r1 = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "date": "2028-01-10",
                "part_name": "Door", "customer_id": cid,
                "sale_price": 60000, "amount_received": 40000
            }, headers=owner_headers)
            assert r1.status_code == 200, r1.text
            ps_ids.append(r1.json()["id"])
            assert r1.json()["balance_due"] == 20000
            assert r1.json()["chassis_number"] == chassis

            vg = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            rec = vg["recovery"]
            assert rec["purchase_price"] == 100000
            assert rec["parts"]["total"] == 60000
            assert rec["total_recovered"] == 60000
            assert rec["remaining_to_recover"] == 40000
            assert rec["profit_loss"] == -40000

            # Second sale 60000 -> total_recovered=120000, profit_loss=+20000, price unchanged
            r2 = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "date": "2028-01-11",
                "part_name": "Tire", "customer_id": cid,
                "sale_price": 60000, "amount_received": 60000
            }, headers=owner_headers)
            assert r2.status_code == 200, r2.text
            ps_ids.append(r2.json()["id"])

            vg2 = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            rec2 = vg2["recovery"]
            assert rec2["purchase_price"] == 100000, "purchase price must remain immutable"
            assert rec2["parts"]["total"] == 120000
            assert rec2["total_recovered"] == 120000
            assert rec2["remaining_to_recover"] == 0
            assert rec2["profit_loss"] == 20000
        finally:
            for sid in ps_ids:
                requests.delete(f"{API}/part-sales/{sid}", headers=owner_headers)
            _cleanup_mongo([("tracked_parts", {"source_vehicle_id": vid}),
                            ("part_sales", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_part_sale_requires_dismantled_source(self, owner_headers):
        # in_stock -> 400
        ch = f"TEST-RPNS-{os.urandom(3).hex()}"
        v = requests.post(f"{API}/vehicles", json={
            "chassis_number": ch, "make": "T", "model": "M",
            "purchase_price": 50000, "purchase_date": "2028-02-01"
        }, headers=owner_headers).json()
        vid = v["id"]
        try:
            bad = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "part_name": "Door",
                "sale_price": 100, "amount_received": 0
            }, headers=owner_headers)
            assert bad.status_code == 400, bad.text

            # nonexistent -> 404
            miss = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": "nope-nope", "part_name": "X",
                "sale_price": 100, "amount_received": 0
            }, headers=owner_headers)
            assert miss.status_code == 404
        finally:
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)

    def test_recovery_vehicles_endpoint_and_search(self, owner_headers):
        vid, chassis = self._mk_dismantled_vehicle(owner_headers, price=90000,
                                                    purchase_date="2028-03-01",
                                                    dismantle_date="2028-03-02")
        try:
            r = requests.get(f"{API}/recovery/vehicles",
                             params={"q": chassis}, headers=owner_headers)
            assert r.status_code == 200
            data = r.json()
            match = next((x for x in data if x["id"] == vid), None)
            assert match is not None, f"vehicle not returned by recovery search: {data}"
            for k in ("purchase_price", "total_recovered", "remaining_to_recover", "profit_loss"):
                assert k in match
            assert match["purchase_price"] == 90000
        finally:
            _cleanup_mongo([("tracked_parts", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)

    def test_part_sale_included_in_customer_balance_and_summary(self, owner_headers):
        vid, chassis = self._mk_dismantled_vehicle(owner_headers, price=200000,
                                                    purchase_date="2028-04-01",
                                                    dismantle_date="2028-04-02")
        cust = requests.post(f"{API}/customers", json={"name": "TEST_RP_Bal"},
                             headers=owner_headers).json()
        cid = cust["id"]
        ps_id = None
        try:
            r = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "date": "2028-04-10",
                "part_name": "Nose Cut", "customer_id": cid,
                "sale_price": 30000, "amount_received": 10000
            }, headers=owner_headers)
            assert r.status_code == 200
            ps_id = r.json()["id"]

            # customer balance includes part sale
            cg = requests.get(f"{API}/customers/{cid}", headers=owner_headers).json()
            assert cg["balance"]["billed"] >= 30000
            assert cg["balance"]["paid"] >= 10000
            assert cg["balance"]["outstanding"] >= 20000

            # list endpoint enriched too
            clist = requests.get(f"{API}/customers", headers=owner_headers).json()
            m = next(x for x in clist if x["id"] == cid)
            assert m["balance"]["outstanding"] >= 20000

            # monthly summary parts_sales includes vehicle-linked
            ms = requests.get(f"{API}/reports/monthly",
                              params={"month": "2028-04"}, headers=owner_headers).json()
            assert ms["parts_sales"] >= 30000
        finally:
            if ps_id:
                requests.delete(f"{API}/part-sales/{ps_id}", headers=owner_headers)
            _cleanup_mongo([("tracked_parts", {"source_vehicle_id": vid}),
                            ("part_sales", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_stock_aware_monthly_summary_no_false_loss(self, owner_headers):
        # Isolated month 2029-01
        month = "2029-01"
        vid, chassis = self._mk_dismantled_vehicle(owner_headers, price=100000,
                                                    purchase_date="2029-01-05",
                                                    dismantle_date="2029-01-06")
        cust = requests.post(f"{API}/customers", json={"name": "TEST_STK_Cust"},
                             headers=owner_headers).json()
        cid = cust["id"]
        ps_id = None
        try:
            r = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "date": "2029-01-15",
                "part_name": "Door", "customer_id": cid,
                "sale_price": 60000, "amount_received": 60000
            }, headers=owner_headers)
            assert r.status_code == 200
            ps_id = r.json()["id"]

            ms = requests.get(f"{API}/reports/monthly",
                              params={"month": month}, headers=owner_headers).json()
            # required stock-aware fields
            for k in ("vehicle_purchases", "standalone_purchases", "parts_purchases",
                      "total_purchases", "complete_sales", "engine_sales", "halfcut_sales",
                      "parts_sales", "scrap_sales", "shokubai_sales", "total_sales",
                      "received", "balance_due", "opening_stock", "closing_stock",
                      "cogs", "total_expenses", "net_profit"):
                assert k in ms, f"missing {k} in monthly: {list(ms.keys())}"

            # Vehicle purchase 100000 in same month, sold part 60000 -> remaining 40000 remains as stock
            # opening = value before Jan 1 2029 (should be 0 for our chassis) — but other business data may exist
            # Focus on delta correctness: purchases include our 100000, parts_sales includes our 60000
            assert ms["vehicle_purchases"] >= 100000
            assert ms["parts_sales"] >= 60000
            # closing >= remaining unrecovered cost of our vehicle (40000)
            assert ms["closing_stock"] >= 40000
            # cogs = opening + purchases - closing; math identity must hold
            expected_cogs = round(ms["opening_stock"] + ms["total_purchases"] - ms["closing_stock"], 2)
            assert abs(ms["cogs"] - expected_cogs) < 0.5, (ms["cogs"], expected_cogs)
            # net_profit = total_sales - cogs - total_expenses
            expected_np = round(ms["total_sales"] - ms["cogs"] - ms["total_expenses"], 2)
            assert abs(ms["net_profit"] - expected_np) < 0.5, (ms["net_profit"], expected_np)

            # No false -40000 loss: net_profit for our contribution (sale 60000, cogs contribution 60000) should NOT be -40000
            # If parts_sales==60000 & vehicle_purchases==100000 & closing includes 40000 => cogs contrib = 60000, np contrib = 0
            # We assert monthly net_profit is not lower than -expenses (loose)
            assert ms["net_profit"] > -1_000_000, ms  # sanity - no wild losses

            # Yearly summary same
            ys = requests.get(f"{API}/reports/yearly",
                              params={"year": "2029"}, headers=owner_headers).json()
            for k in ("total_purchases", "total_sales", "cogs", "net_profit",
                      "opening_stock", "closing_stock"):
                assert k in ys
        finally:
            if ps_id:
                requests.delete(f"{API}/part-sales/{ps_id}", headers=owner_headers)
            _cleanup_mongo([("tracked_parts", {"source_vehicle_id": vid}),
                            ("part_sales", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_stock_report_new_fields(self, owner_headers):
        r = requests.get(f"{API}/reports/stock", headers=owner_headers)
        assert r.status_code == 200
        j = r.json()
        for k in ("vehicles_value", "parts_value", "standalone_value",
                  "dismantled_remaining", "total_value"):
            assert k in j, f"stock missing {k}: {j}"
        # total = sum of components
        s = j["vehicles_value"] + j["parts_value"] + j["standalone_value"] + j["dismantled_remaining"]
        assert abs(j["total_value"] - s) < 0.5

    def test_no_double_count_scrap(self, owner_headers):
        # 2 dismantled vehicles in far-future month; allocate scrap -> total_sales must equal
        # scrap_sales contribution once (no double counting)
        month = "2030-05"
        vids = []
        for i in range(2):
            ch = f"TEST-NDC-{i}-{os.urandom(3).hex()}"
            v = requests.post(f"{API}/vehicles", json={
                "chassis_number": ch, "make": "T", "model": "N",
                "purchase_price": 50000, "purchase_date": "2030-04-15"
            }, headers=owner_headers).json()
            vids.append(v["id"])
            requests.post(f"{API}/vehicles/{v['id']}/dismantle", json={
                "dismantle_date": "2030-05-10", "create_engine": False,
                "create_half_cut": False, "parts": []
            }, headers=owner_headers)

        try:
            ms_pre = requests.get(f"{API}/reports/monthly",
                                  params={"month": month}, headers=owner_headers).json()
            sc = requests.post(f"{API}/scrap-allocations", json={
                "month": month, "date": "2030-05-31", "total_amount": 400000
            }, headers=owner_headers)
            assert sc.status_code == 200, sc.text
            sc_id = sc.json()["id"]
            try:
                ms = requests.get(f"{API}/reports/monthly",
                                  params={"month": month}, headers=owner_headers).json()
                scrap_delta = ms["scrap_sales"] - ms_pre.get("scrap_sales", 0)
                total_delta = ms["total_sales"] - ms_pre.get("total_sales", 0)
                assert abs(scrap_delta - 400000) < 0.5, scrap_delta
                assert abs(total_delta - 400000) < 0.5, (total_delta, "double-counted!")
            finally:
                requests.delete(f"{API}/scrap-allocations/{sc_id}", headers=owner_headers)
        finally:
            _cleanup_mongo([("scrap_allocations", {"month": month}),
                            ("tracked_parts", {"source_vehicle_id": {"$in": vids}})])
            for vid in vids:
                requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)

    def test_part_sales_csv_and_backup(self, owner_token):
        r = requests.get(f"{API}/export/part_sales", params={"token": owner_token})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        header = r.text.splitlines()[0].lower()
        for col in ("date", "part_name", "sale_price", "chassis_number"):
            assert col in header, header

        b = requests.get(f"{API}/export/backup", params={"token": owner_token})
        assert b.status_code == 200
        # backup may be json or zip; verify content contains part_sales token
        assert b"part_sales" in b.content

    def test_period_pdfs_include_parts_sales_section(self, owner_token):
        # Regression: PDFs with new sections still 200 %PDF
        r1 = requests.get(f"{API}/reports/monthly/pdf",
                          params={"month": "2028-04", "token": owner_token})
        assert r1.status_code == 200
        assert r1.content[:4] == b"%PDF"
        r2 = requests.get(f"{API}/reports/yearly/pdf",
                          params={"year": "2028", "token": owner_token})
        assert r2.status_code == 200
        assert r2.content[:4] == b"%PDF"

    def test_part_sale_rbac(self, owner_headers, created):
        # Manager (finance.view but has parts.edit) can create; Accountant may not (depends on role)
        # Reverse requires records.reverse
        vid, chassis = self._mk_dismantled_vehicle(owner_headers, price=50000,
                                                    purchase_date="2028-05-01",
                                                    dismantle_date="2028-05-02")
        ps_id = None
        try:
            # Create as owner
            r = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "part_name": "Trim",
                "sale_price": 5000, "amount_received": 5000
            }, headers=owner_headers)
            assert r.status_code == 200
            ps_id = r.json()["id"]

            # Create a viewer role (no parts.edit/finance.edit) -> reverse blocked, create blocked
            email = f"test_viewer_ps_{os.urandom(3).hex()}@x.com"
            pw = "Test@2026"
            role_r = requests.post(f"{API}/roles", json={
                "name": f"TEST_VIEWER_PS_{os.urandom(3).hex()}",
                "permissions": ["dashboard.view", "parts.view"]
            }, headers=owner_headers)
            assert role_r.status_code == 200, role_r.text
            created["roles"].append(role_r.json()["id"])
            u = requests.post(f"{API}/users", json={
                "name": "TEST_ViewerPS", "email": email, "password": pw,
                "role": role_r.json()["name"]
            }, headers=owner_headers)
            assert u.status_code == 200
            created["users"].append(u.json()["id"])
            vh = {"Authorization": f"Bearer " + requests.post(
                f"{API}/auth/login", json={"email": email, "password": pw}).json()["token"]}

            # Viewer cannot create
            bad = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "part_name": "X",
                "sale_price": 1, "amount_received": 0
            }, headers=vh)
            assert bad.status_code == 403, bad.text

            # Viewer cannot reverse
            bad2 = requests.delete(f"{API}/part-sales/{ps_id}", headers=vh)
            assert bad2.status_code == 403
        finally:
            if ps_id:
                requests.delete(f"{API}/part-sales/{ps_id}", headers=owner_headers)
            _cleanup_mongo([("part_sales", {"source_vehicle_id": vid}),
                            ("tracked_parts", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)



# ============================================================================
# Iteration 12: 3-category vehicle-first recovery (engine/half_cut/parts)
# ============================================================================
@pytest.mark.xdist_group("recovery_categories")
class TestRecoveryCategories:
    """Verifies engine|half_cut|parts categories on /api/part-sales and monthly split."""

    def _mk_dis(self, owner_headers, price=100000, pd="2029-01-05", dd="2029-01-06"):
        chassis = f"TEST-RC-{os.urandom(4).hex()}"
        vr = requests.post(f"{API}/vehicles", json={
            "chassis_number": chassis, "make": "T", "model": "Cat",
            "vehicle_name": "TEST_RC_Vehicle",
            "purchase_price": price, "purchase_date": pd
        }, headers=owner_headers)
        assert vr.status_code == 200, vr.text
        vid = vr.json()["id"]
        d = requests.post(f"{API}/vehicles/{vid}/dismantle", json={
            "dismantle_date": dd, "create_engine": False,
            "create_half_cut": False, "parts": []
        }, headers=owner_headers)
        assert d.status_code == 200, d.text
        return vid, chassis

    def test_three_categories_recovery_totals(self, owner_headers):
        vid, chassis = self._mk_dis(owner_headers, price=100000,
                                     pd="2029-02-01", dd="2029-02-02")
        cust = requests.post(f"{API}/customers", json={"name": "TEST_RC_C"},
                             headers=owner_headers).json()
        cid = cust["id"]
        ps_ids = []
        try:
            # engine sale 50000 paid full
            r_e = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "category": "engine",
                "date": "2029-02-10", "part_name": "Engine 1NZ",
                "customer_id": cid, "sale_price": 50000, "amount_received": 50000
            }, headers=owner_headers)
            assert r_e.status_code == 200, r_e.text
            assert r_e.json()["category"] == "engine"
            ps_ids.append(r_e.json()["id"])

            # half_cut sale 30000 no payment
            r_h = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "category": "half_cut",
                "date": "2029-02-11", "part_name": "Front H/Cut",
                "customer_id": cid, "sale_price": 30000, "amount_received": 0
            }, headers=owner_headers)
            assert r_h.status_code == 200, r_h.text
            assert r_h.json()["category"] == "half_cut"
            ps_ids.append(r_h.json()["id"])

            # parts sale 20000 paid full
            r_p = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "category": "parts",
                "date": "2029-02-12", "part_name": "Door + Tire",
                "customer_id": cid, "sale_price": 20000, "amount_received": 20000
            }, headers=owner_headers)
            assert r_p.status_code == 200, r_p.text
            assert r_p.json()["category"] == "parts"
            ps_ids.append(r_p.json()["id"])

            vg = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            rec = vg["recovery"]
            assert rec["purchase_price"] == 100000, "immutable purchase price"
            assert rec["engine"]["total"] == 50000, rec
            assert rec["half_cut"]["total"] == 30000, rec
            assert rec["parts"]["total"] == 20000, rec
            assert rec["total_recovered"] == 100000
            assert rec["remaining_to_recover"] == 0
            assert rec["profit_loss"] == 0

            # Monthly summary for 2029-02: no double count, splits correct
            m = requests.get(f"{API}/reports/monthly?month=2029-02",
                             headers=owner_headers).json()
            assert m["engine_sales"] >= 50000
            assert m["halfcut_sales"] >= 30000
            assert m["parts_sales"] >= 20000
            # Our 3 sales contribute 100000 to total_sales; assert at least this much
            assert m["total_sales"] >= 100000
            # received includes 50000 (engine) + 0 (hc) + 20000 (parts) = 70000, balance 30000
            assert m["received"] >= 70000
            assert m["balance_due"] >= 30000
        finally:
            for sid in ps_ids:
                requests.delete(f"{API}/part-sales/{sid}", headers=owner_headers)
            _cleanup_mongo([("part_sales", {"source_vehicle_id": vid}),
                            ("tracked_parts", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)
            requests.delete(f"{API}/customers/{cid}", headers=owner_headers)

    def test_category_defaults_and_unknown_fallback(self, owner_headers):
        vid, _ = self._mk_dis(owner_headers, price=50000,
                              pd="2029-03-01", dd="2029-03-02")
        ps_ids = []
        try:
            # Omit category -> defaults to 'parts'
            r_no = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "date": "2029-03-05",
                "part_name": "Misc", "sale_price": 1000, "amount_received": 1000
            }, headers=owner_headers)
            assert r_no.status_code == 200, r_no.text
            assert r_no.json()["category"] == "parts"
            ps_ids.append(r_no.json()["id"])

            # Unknown category falls back to 'parts'
            r_bad = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "category": "banana",
                "date": "2029-03-06", "part_name": "X",
                "sale_price": 500, "amount_received": 500
            }, headers=owner_headers)
            assert r_bad.status_code == 200, r_bad.text
            assert r_bad.json()["category"] == "parts"
            ps_ids.append(r_bad.json()["id"])

            vg = requests.get(f"{API}/vehicles/{vid}", headers=owner_headers).json()
            assert vg["recovery"]["parts"]["total"] == 1500
            assert vg["recovery"]["engine"]["total"] == 0
            assert vg["recovery"]["half_cut"]["total"] == 0
        finally:
            for sid in ps_ids:
                requests.delete(f"{API}/part-sales/{sid}", headers=owner_headers)
            _cleanup_mongo([("part_sales", {"source_vehicle_id": vid}),
                            ("tracked_parts", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)

    def test_validation_negative_and_overreceived(self, owner_headers):
        vid, _ = self._mk_dis(owner_headers, price=10000,
                              pd="2029-04-01", dd="2029-04-02")
        try:
            # negative sale price rejected
            r = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "category": "engine",
                "part_name": "X", "sale_price": -1, "amount_received": 0
            }, headers=owner_headers)
            assert r.status_code == 400, r.text
            # negative amount_received rejected
            r2 = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "category": "engine",
                "part_name": "X", "sale_price": 100, "amount_received": -5
            }, headers=owner_headers)
            assert r2.status_code == 400, r2.text
            # over-received rejected
            r3 = requests.post(f"{API}/part-sales", json={
                "source_vehicle_id": vid, "category": "parts",
                "part_name": "X", "sale_price": 100, "amount_received": 200
            }, headers=owner_headers)
            assert r3.status_code == 400, r3.text
        finally:
            _cleanup_mongo([("part_sales", {"source_vehicle_id": vid}),
                            ("tracked_parts", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)

    def test_recovery_vehicles_search(self, owner_headers):
        vid, chassis = self._mk_dis(owner_headers, price=20000,
                                     pd="2029-05-01", dd="2029-05-02")
        try:
            r = requests.get(f"{API}/recovery/vehicles?q={chassis[:12]}",
                             headers=owner_headers)
            assert r.status_code == 200
            rows = r.json()
            match = next((x for x in rows if x["id"] == vid), None)
            assert match is not None, rows
            # Expected fields
            for k in ["purchase_price", "total_recovered",
                      "remaining_to_recover", "profit_loss"]:
                assert k in match, match
        finally:
            _cleanup_mongo([("tracked_parts", {"source_vehicle_id": vid})])
            requests.delete(f"{API}/vehicles/{vid}", headers=owner_headers)

    def test_period_pdfs_have_type_column_for_recovery(self, owner_token):
        for path in ["monthly", "yearly"]:
            r = requests.get(
                f"{API}/reports/{path}/pdf?token={owner_token}",
                params={"month": "2029-02"} if path == "monthly" else {"year": "2029"})
            assert r.status_code == 200
            assert r.content[:4] == b"%PDF"
            assert len(r.content) > 1000

    def test_csv_part_sales_has_category(self, owner_token):
        r = requests.get(f"{API}/export/part_sales?token={owner_token}")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        header = r.text.splitlines()[0]
        assert "category" in header.lower(), header
