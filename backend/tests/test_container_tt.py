"""Container & TT module backend tests.

Covers: /api/container-invoices CRUD, /api/income-tt CRUD, /api/container-tt/summary,
due/over/status logic, multi-TT accumulation, and ISOLATION (unrelated totals unchanged).
"""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "owner@example.com"
PASSWORD = "ChangeMe_SetInEnv"
COMPANY = "MTC"

CUSTOMER_ID = "2c0c437e-a602-48a7-ae84-41741bf68984"

created_invoice_ids = []
created_tt_ids = []


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "X-Company-Id": COMPANY})
    r = s.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:300]}"
    token = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def baseline(client):
    """Snapshot of unrelated business totals to verify ISOLATION."""
    d = client.get(f"{API}/dashboard").json()
    c = client.get(f"{API}/customers/{CUSTOMER_ID}")
    cust = c.json() if c.status_code == 200 else None
    return {"dashboard": d, "customer": cust}


def _uniq(tag):
    import time
    return f"TEST_FINAL_{tag}_{int(time.time()*1000)}"


class TestContainerTTFlow:
    def test_00_baseline_snapshot(self, baseline):
        assert baseline["dashboard"] is not None
        # customer may or may not exist; only assert if it does
        print(f"Baseline dashboard keys: {list(baseline['dashboard'].keys())}")

    def test_01_create_invoice_A_and_verify_total(self, client):
        inv_no = _uniq("INVA")
        payload = {
            "company_name": "TEST_FINAL_CoA",
            "loading_date": "2026-07-01",
            "container_no": _uniq("CNTA"),
            "invoice_number": inv_no,
            "final_destination": "Karachi",
            "bl_surrender_date": "2026-07-05",
            "page_count": 1,
            "items": [
                {"no": 1, "name": "Half Cut", "price": 20000},
                {"no": 31, "name": "1NZ", "price": 10000},
            ],
        }
        r = client.post(f"{API}/container-invoices", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        created_invoice_ids.append(data["id"])
        assert data["invoice_number"] == inv_no
        assert data["total"] == 30000
        # GET to verify persistence
        g = client.get(f"{API}/container-invoices/{data['id']}")
        assert g.status_code == 200
        assert g.json()["total"] == 30000
        pytest.invoice_A = data
        pytest.invoice_A_no = inv_no

    def test_02_add_page_items_over_60(self, client):
        inv = pytest.invoice_A
        # Simulate "Add Page" by updating with more items including one > 60
        payload = {
            "company_name": inv["company_name"],
            "loading_date": inv.get("loading_date", ""),
            "container_no": inv.get("container_no", ""),
            "invoice_number": inv["invoice_number"],
            "final_destination": inv.get("final_destination", ""),
            "bl_surrender_date": inv.get("bl_surrender_date", ""),
            "page_count": 2,
            "items": inv["items"] + [{"no": 61, "name": "Page2Item", "price": 5000}],
        }
        r = client.put(f"{API}/container-invoices/{inv['id']}", json=payload)
        assert r.status_code == 200, r.text
        g = client.get(f"{API}/container-invoices/{inv['id']}").json()
        assert g["total"] == 35000
        assert g["page_count"] == 2
        assert any(it["no"] == 61 for it in g["items"])
        pytest.invoice_A_total = 35000

    def test_03_partial_tt_shows_due(self, client):
        inv_no = pytest.invoice_A_no
        r = client.post(f"{API}/income-tt", json={
            "date": "2026-07-02", "invoice_number": inv_no,
            "income_tt_amount": 20000, "note": "TEST_FINAL partial"
        })
        assert r.status_code == 200
        created_tt_ids.append(r.json()["id"])
        rows = client.get(f"{API}/income-tt").json()
        row = next(x for x in rows if x["id"] == created_tt_ids[-1])
        assert row["cnr_amount"] == 35000
        assert row["cumulative_tt"] == 20000
        assert row["due"] == 15000
        assert row["over"] == 0
        assert row["status"] == "partial"
        assert row["from"] == "TEST_FINAL_CoA"

    def test_04_full_payment_status_paid(self, client):
        inv_no = pytest.invoice_A_no
        r = client.post(f"{API}/income-tt", json={
            "date": "2026-07-03", "invoice_number": inv_no,
            "income_tt_amount": 15000, "note": "TEST_FINAL top-up"
        })
        assert r.status_code == 200
        created_tt_ids.append(r.json()["id"])
        rows = [x for x in client.get(f"{API}/income-tt").json() if x["invoice_number"] == inv_no]
        # All rows for this invoice should reflect cumulative == cnr
        for row in rows:
            assert row["cumulative_tt"] == 35000
            assert row["due"] == 0
            assert row["over"] == 0
            assert row["status"] == "paid"

    def test_05_overpayment_status_overpaid(self, client):
        inv_no = pytest.invoice_A_no
        r = client.post(f"{API}/income-tt", json={
            "date": "2026-07-04", "invoice_number": inv_no,
            "income_tt_amount": 5000, "note": "TEST_FINAL overpay"
        })
        assert r.status_code == 200
        created_tt_ids.append(r.json()["id"])
        rows = [x for x in client.get(f"{API}/income-tt").json() if x["invoice_number"] == inv_no]
        for row in rows:
            assert row["cumulative_tt"] == 40000
            assert row["over"] == 5000
            assert row["due"] == 0
            assert row["status"] == "overpaid"

    def test_06_second_invoice_underpaid_for_summary_split(self, client):
        inv_no = _uniq("INVB")
        payload = {
            "company_name": "TEST_FINAL_CoB",
            "invoice_number": inv_no,
            "container_no": _uniq("CNTB"),
            "items": [{"no": 1, "name": "Widget", "price": 50000}],
        }
        r = client.post(f"{API}/container-invoices", json=payload)
        assert r.status_code == 200
        created_invoice_ids.append(r.json()["id"])
        # pay 10000 -> due = 40000
        rt = client.post(f"{API}/income-tt", json={
            "date": "2026-07-05", "invoice_number": inv_no, "income_tt_amount": 10000
        })
        assert rt.status_code == 200
        created_tt_ids.append(rt.json()["id"])
        pytest.invoice_B_no = inv_no

    def test_07_summary_due_and_over_both_positive(self, client):
        s = client.get(f"{API}/container-tt/summary")
        assert s.status_code == 200
        data = s.json()
        assert data["total_due"] > 0, f"Expected due>0 got {data}"
        assert data["total_over"] > 0, f"Expected over>0 got {data}"
        # totals must include our test invoices (>= 35000+50000 for invoices, >= 50000 tt)
        assert data["total_invoice_amount"] >= 85000
        assert data["total_tt_received"] >= 50000

    def test_08_isolation_dashboard_and_customer_unchanged(self, client, baseline):
        d_now = client.get(f"{API}/dashboard").json()
        base = baseline["dashboard"]
        # Compare numeric fields we care about (only keys present in baseline)
        for k, v in base.items():
            if isinstance(v, (int, float)):
                assert d_now.get(k) == v, f"Dashboard field '{k}' changed: {v} -> {d_now.get(k)}"
        if baseline["customer"]:
            c_now = client.get(f"{API}/customers/{CUSTOMER_ID}").json()
            for k, v in baseline["customer"].items():
                if isinstance(v, (int, float)):
                    assert c_now.get(k) == v, f"Customer field '{k}' changed: {v} -> {c_now.get(k)}"

    def test_09_delete_tt_updates_status(self, client):
        # delete overpay row and check status returns to paid for invoice A
        inv_no = pytest.invoice_A_no
        # find the 5000 row
        rows = [x for x in client.get(f"{API}/income-tt").json() if x["invoice_number"] == inv_no and x["income_tt_amount"] == 5000]
        assert rows
        tid = rows[0]["id"]
        r = client.delete(f"{API}/income-tt/{tid}")
        assert r.status_code == 200
        created_tt_ids.remove(tid)
        rows = [x for x in client.get(f"{API}/income-tt").json() if x["invoice_number"] == inv_no]
        for row in rows:
            assert row["status"] == "paid"
            assert row["cumulative_tt"] == 35000


@pytest.fixture(scope="module", autouse=True)
def cleanup(client):
    yield
    for tid in list(created_tt_ids):
        client.delete(f"{API}/income-tt/{tid}")
    for iid in list(created_invoice_ids):
        client.delete(f"{API}/container-invoices/{iid}")
