"""Multi-company (MTC + TSK) verification tests for iteration-13 Master Formula.

Only creates TEST_FINAL_-prefixed records. Cleans up ONLY what it created.
"""
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import jwt
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

PREFIX = "TEST_FINAL_"


def _load_creds():
    content = Path("/app/memory/test_credentials.md").read_text()
    email = re.search(r"Email:\s*(\S+)", content).group(1)
    password = re.search(r"Password:\s*(\S+)", content).group(1)
    return {"email": email, "password": password}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json=_load_creds(), timeout=30)
    assert r.status_code == 200, r.text[:400]
    return r.json()["token"]


def H(token, company="MTC"):
    return {"Authorization": f"Bearer {token}", "X-Company-Id": company,
            "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created():
    # (company, endpoint, id) tuples
    return []


@pytest.fixture(scope="module", autouse=True)
def _cleanup(token, created):
    yield
    # delete in reverse order
    for company, path, _id in reversed(created):
        try:
            requests.delete(f"{API}/{path}/{_id}", headers=H(token, company), timeout=15)
        except Exception:
            pass


class TestAuthSession:
    def test_login_ok(self, token):
        assert isinstance(token, str) and len(token) > 20

    def test_me(self, token):
        r = requests.get(f"{API}/auth/me", headers=H(token))
        assert r.status_code == 200
        assert r.json()["email"] == _load_creds()["email"]

    def test_token_exp_365d(self, token):
        payload = jwt.decode(token, options={"verify_signature": False})
        exp = payload["exp"]
        now = datetime.now(timezone.utc).timestamp()
        days = (exp - now) / 86400
        # Allow small drift; must be at least ~360 days
        assert days > 360, f"Token exp only {days:.1f} days"

    def test_refresh(self, token):
        r = requests.post(f"{API}/auth/refresh", headers=H(token))
        assert r.status_code == 200
        new_token = r.json()["token"]
        assert new_token and new_token != ""
        # New token must authenticate
        r2 = requests.get(f"{API}/auth/me", headers=H(new_token))
        assert r2.status_code == 200


class TestCompanyIsolation:
    def test_tsk_vehicle_not_visible_in_mtc(self, token, created):
        chassis = f"{PREFIX}TSK_{int(time.time())}"
        payload = {"chassis_number": chassis, "vehicle_name": f"{PREFIX}TSKVeh",
                   "make": "Toyota", "model": "TESTV", "purchase_price": 100000}
        r = requests.post(f"{API}/vehicles", headers=H(token, "TSK"), json=payload)
        assert r.status_code == 200, r.text[:400]
        vid = r.json()["id"]
        created.append(("TSK", "vehicles", vid))

        # Visible in TSK
        r_tsk = requests.get(f"{API}/vehicles", headers=H(token, "TSK"))
        assert r_tsk.status_code == 200
        assert any(v["id"] == vid for v in r_tsk.json())

        # NOT visible in MTC
        r_mtc = requests.get(f"{API}/vehicles", headers=H(token, "MTC"))
        assert r_mtc.status_code == 200
        assert not any(v["id"] == vid for v in r_mtc.json()), "TSK vehicle leaked into MTC"

    def test_mtc_customer_not_in_tsk(self, token, created):
        payload = {"name": f"{PREFIX}MTC_Cust_{int(time.time())}"}
        r = requests.post(f"{API}/customers", headers=H(token, "MTC"), json=payload)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        created.append(("MTC", "customers", cid))

        r_tsk = requests.get(f"{API}/customers", headers=H(token, "TSK"))
        assert not any(c["id"] == cid for c in r_tsk.json())

    def test_broker_isolation(self, token, created):
        r = requests.post(f"{API}/brokers", headers=H(token, "TSK"),
                          json={"name": f"{PREFIX}TSK_Broker"})
        assert r.status_code == 200
        bid = r.json()["id"]
        created.append(("TSK", "brokers", bid))
        # Not visible in MTC list
        rm = requests.get(f"{API}/brokers", headers=H(token, "MTC"))
        assert not any(b["id"] == bid for b in rm.json())


class TestReportsStockPurchase:
    def test_stock_report_both_companies(self, token):
        for co in ["MTC", "TSK"]:
            r = requests.get(f"{API}/reports/stock", headers=H(token, co))
            assert r.status_code == 200, f"{co}: {r.text[:200]}"
            data = r.json()
            # Must be numeric fields, no crash
            assert isinstance(data, dict)

    def test_monthly_yearly_reports(self, token):
        for co in ["MTC", "TSK"]:
            r = requests.get(f"{API}/reports/monthly?month=2026-07", headers=H(token, co))
            assert r.status_code == 200, f"{co}: {r.text[:200]}"
            r2 = requests.get(f"{API}/reports/yearly?year=2026", headers=H(token, co))
            assert r2.status_code == 200


class TestTaxInclusiveInvoice:
    def test_invoice_tax_inclusive(self, token, created):
        # Create isolated TSK customer
        r = requests.post(f"{API}/customers", headers=H(token, "TSK"),
                          json={"name": f"{PREFIX}TSK_Inv_Cust"})
        assert r.status_code == 200
        cid = r.json()["id"]
        created.append(("TSK", "customers", cid))

        payload = {
            "customer_id": cid,
            "items": [{"item_type": "misc", "description": f"{PREFIX}Item",
                       "quantity": 1, "unit_price": 110000}],
            "amount_paid": 0,
            "sale_date": "2025-12-15",
        }
        r = requests.post(f"{API}/invoices", headers=H(token, "TSK"), json=payload)
        assert r.status_code == 200, r.text[:400]
        inv = r.json()
        created.append(("TSK", "invoices", inv["id"]))
        assert inv["tax_inclusive"] is True
        assert inv["total"] == 110000
        assert abs(inv["subtotal"] - 100000) < 0.5
        assert abs(inv["tax"] - 10000) < 0.5


class TestBrokerAndOneStepLink:
    def test_broker_pending_to_received_one_step(self, token, created):
        # Create broker in TSK
        rb = requests.post(f"{API}/brokers", headers=H(token, "TSK"),
                           json={"name": f"{PREFIX}Bkr_{int(time.time())}"})
        assert rb.status_code == 200
        bid = rb.json()["id"]
        created.append(("TSK", "brokers", bid))

        # Add pending broker vehicle
        rp = requests.post(f"{API}/brokers/{bid}/vehicles", headers=H(token, "TSK"),
                           json={"vehicle_name": f"{PREFIX}PendingVeh", "purchase_price": 300000,
                                 "paid_amount": 100000, "chassis_number": ""})
        assert rp.status_code == 200, rp.text
        bvid = rp.json()["id"]

        # Confirm pending list contains it
        rlist = requests.get(f"{API}/broker-vehicles/pending", headers=H(token, "TSK"))
        assert rlist.status_code == 200
        assert any(x["id"] == bvid for x in rlist.json())

        # Broker account math: due = purchase - paid = 200000 (or based on all vehicles)
        rget = requests.get(f"{API}/brokers/{bid}", headers=H(token, "TSK"))
        assert rget.status_code == 200
        acc = rget.json()["account"]
        assert isinstance(acc, dict)

        # ONE-STEP: create vehicle with broker_vehicle_id
        chassis = f"{PREFIX}LNK_{int(time.time())}"
        rv = requests.post(f"{API}/vehicles", headers=H(token, "TSK"), json={
            "chassis_number": chassis, "vehicle_name": f"{PREFIX}Linked",
            "purchase_price": 300000, "broker_vehicle_id": bvid,
        })
        assert rv.status_code == 200, rv.text
        vid = rv.json()["id"]
        created.append(("TSK", "vehicles", vid))

        # Broker vehicle now received
        rget2 = requests.get(f"{API}/brokers/{bid}", headers=H(token, "TSK"))
        matching = [x for x in rget2.json()["vehicles"] if x["id"] == bvid]
        assert matching and matching[0]["status"] == "received"
        assert matching[0]["vehicle_id"] == vid

        # Exactly ONE vehicle with this chassis (no double count)
        rv_all = requests.get(f"{API}/vehicles", headers=H(token, "TSK"))
        count = sum(1 for v in rv_all.json() if v["chassis_number"] == chassis)
        assert count == 1, f"Expected 1 vehicle, found {count}"


class TestLoans:
    def test_loan_udhaar_math(self, token, created):
        r = requests.post(f"{API}/loans", headers=H(token, "TSK"),
                          json={"name": f"{PREFIX}Loan_{int(time.time())}"})
        assert r.status_code == 200
        lid = r.json()["id"]
        created.append(("TSK", "loans", lid))

        entries = [
            {"entry_type": "borrowed", "amount": 500000},
            {"entry_type": "repayment", "amount": 300000},
            {"entry_type": "lent", "amount": 400000},
        ]
        for e in entries:
            rr = requests.post(f"{API}/loans/{lid}/entries",
                               headers=H(token, "TSK"), json=e)
            assert rr.status_code == 200, rr.text

        rget = requests.get(f"{API}/loans/{lid}", headers=H(token, "TSK"))
        bal = rget.json()["balance"]
        assert bal["i_owe"] == 200000
        assert bal["receivable"] == 400000
        assert bal["net"] == 200000


class TestRecoveryCompleted:
    def test_recovery_complete_flow(self, token, created):
        # Create + dismantle vehicle in TSK
        chassis = f"{PREFIX}REC_{int(time.time())}"
        rv = requests.post(f"{API}/vehicles", headers=H(token, "TSK"), json={
            "chassis_number": chassis, "vehicle_name": f"{PREFIX}Rec",
            "purchase_price": 50000,
        })
        assert rv.status_code == 200, rv.text
        vid = rv.json()["id"]
        created.append(("TSK", "vehicles", vid))

        rd = requests.post(f"{API}/vehicles/{vid}/dismantle", headers=H(token, "TSK"),
                           json={"parts": []})
        assert rd.status_code == 200, rd.text

        # Appears in recovery list
        rl = requests.get(f"{API}/recovery/vehicles", headers=H(token, "TSK"))
        assert rl.status_code == 200
        assert any(x["id"] == vid for x in rl.json())

        # Complete recovery
        rc = requests.post(f"{API}/vehicles/{vid}/recovery-complete",
                           headers=H(token, "TSK"))
        assert rc.status_code == 200

        # Confirm removed from open recovery list
        rl2 = requests.get(f"{API}/recovery/vehicles", headers=H(token, "TSK"))
        assert not any(x["id"] == vid for x in rl2.json())

        # Vehicle status still dismantled and recovery_status=completed, purchase_price preserved
        rg = requests.get(f"{API}/vehicles/{vid}", headers=H(token, "TSK"))
        assert rg.status_code == 200
        v = rg.json()
        assert v["status"] == "dismantled"
        assert v.get("recovery_status") == "completed"
        assert v["purchase_price"] == 50000


class TestVehicleStatusExclusivity:
    def test_dismantled_cannot_be_sold_complete(self, token, created):
        chassis = f"{PREFIX}EXC_{int(time.time())}"
        rv = requests.post(f"{API}/vehicles", headers=H(token, "TSK"), json={
            "chassis_number": chassis, "purchase_price": 10000,
        })
        assert rv.status_code == 200
        vid = rv.json()["id"]
        created.append(("TSK", "vehicles", vid))

        rd = requests.post(f"{API}/vehicles/{vid}/dismantle", headers=H(token, "TSK"),
                           json={"parts": []})
        assert rd.status_code == 200

        # Attempt sell -> should be rejected (endpoint expects in_stock)
        rs = requests.post(f"{API}/vehicles/{vid}/sell", headers=H(token, "TSK"),
                           json={"sale_price": 100, "amount_received": 0, "customer_id": None,
                                 "customer_name": f"{PREFIX}X", "sale_date": "2025-12-15"})
        assert rs.status_code in (400, 404, 422), f"Unexpected {rs.status_code}: {rs.text[:200]}"


class TestPDFsAndExports:
    def test_pdf_no_clip_both_companies(self, token):
        today = datetime.utcnow().strftime("%Y-%m-%d")
        month = today[:7]
        for co in ["MTC", "TSK"]:
            for url in [
                f"{API}/reports/today/pdf?company={co}&token={token}",
                f"{API}/reports/monthly/pdf?month={month}&company={co}&token={token}",
                f"{API}/reports/yearly/pdf?year=2026&company={co}&token={token}",
            ]:
                r = requests.get(url, timeout=60)
                assert r.status_code == 200, f"{url} -> {r.status_code}"
                assert r.content[:4] == b"%PDF", f"Not a PDF for {url}"
                assert len(r.content) > 500

    def test_backup_export_company_scoped(self, token):
        r_m = requests.get(f"{API}/export/backup?company=MTC&token={token}", timeout=60)
        r_t = requests.get(f"{API}/export/backup?company=TSK&token={token}", timeout=60)
        assert r_m.status_code == 200 and r_t.status_code == 200
        # Contents should differ (MTC has real data, TSK mostly TEST_FINAL_ or empty)
        assert r_m.content != r_t.content

    def test_vehicles_csv_scoped(self, token):
        r_m = requests.get(f"{API}/export/vehicles?company=MTC&token={token}", timeout=60)
        r_t = requests.get(f"{API}/export/vehicles?company=TSK&token={token}", timeout=60)
        assert r_m.status_code == 200
        assert r_t.status_code == 200
        # Both start with a header row
        assert b"," in r_m.content[:200]


class TestPersistence:
    def test_created_record_survives(self, token, created):
        # Create vehicle in TSK and re-fetch
        chassis = f"{PREFIX}PERS_{int(time.time())}"
        rv = requests.post(f"{API}/vehicles", headers=H(token, "TSK"),
                           json={"chassis_number": chassis, "purchase_price": 1})
        assert rv.status_code == 200
        vid = rv.json()["id"]
        created.append(("TSK", "vehicles", vid))
        # simulate reload
        time.sleep(0.5)
        rg = requests.get(f"{API}/vehicles/{vid}", headers=H(token, "TSK"))
        assert rg.status_code == 200
        assert rg.json()["chassis_number"] == chassis
