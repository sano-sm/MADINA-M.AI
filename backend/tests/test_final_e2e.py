"""Isolated E2E reproduction test for items 5,6,8 (spare-parts accounting + history).
Creates only TEST_FINAL_ records and cleans up exact IDs."""
import os, requests, datetime, json, sys

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://vehicle-spare-system.preview.emergentagent.com").rstrip("/") + "/api"
EMAIL = "owner@example.com"
PW = "ChangeMe_SetInEnv"


def login():
    r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW})
    r.raise_for_status()
    return r.json()["token"]


def run(company):
    tok = login()
    H = {"Authorization": f"Bearer {tok}", "X-Company-Id": company}
    month = datetime.date.today().strftime("%Y-%m")
    created = {"parts": [], "customers": [], "invoices": []}
    out = {}
    try:
        # baseline summary
        s0 = requests.get(f"{BASE}/reports/monthly", params={"month": month}, headers=H).json()
        # create part: cost 100k qty 1 sale 110k
        p = requests.post(f"{BASE}/parts", headers=H, json={
            "name": f"TEST_FINAL_PART_{company}", "quantity": 1, "unit_cost": 100000,
            "sale_price": 110000, "purchase_date": datetime.date.today().strftime("%Y-%m-%d")}).json()
        created["parts"].append(p["id"])
        out["part_has_purchased_quantity"] = p.get("purchased_quantity")
        # summary after purchase (before sale)
        s1 = requests.get(f"{BASE}/reports/monthly", params={"month": month}, headers=H).json()
        # customer
        c = requests.post(f"{BASE}/customers", headers=H, json={"name": f"TEST_FINAL_CUST_{company}"}).json()
        created["customers"].append(c["id"])
        # invoice selling the part, entered price 110000 (actual sale amount)
        inv = requests.post(f"{BASE}/invoices", headers=H, json={
            "customer_id": c["id"], "amount_paid": 110000,
            "items": [{"description": "TEST_FINAL_PART", "quantity": 1, "unit_price": 110000,
                       "item_type": "part", "ref_id": p["id"]}]}).json()
        created["invoices"].append(inv["id"])
        out["invoice_total"] = inv.get("total")
        out["invoice_subtotal"] = inv.get("subtotal")
        out["invoice_tax"] = inv.get("tax")
        # part after sale
        parts_after = requests.get(f"{BASE}/parts", headers=H).json()
        pa = next((x for x in parts_after if x["id"] == p["id"]), None)
        out["part_still_exists_in_history"] = pa is not None
        out["part_current_qty_after_sale"] = pa.get("quantity") if pa else None
        out["part_purchased_qty_after_sale"] = pa.get("purchased_quantity") if pa else None
        # invoice still listed (sale history)
        invs = requests.get(f"{BASE}/invoices", headers=H).json()
        out["invoice_in_history"] = any(x["id"] == inv["id"] for x in invs)
        # summary after sale
        s2 = requests.get(f"{BASE}/reports/monthly", params={"month": month}, headers=H).json()
        out["parts_purchases_before_sale"] = s1["parts_purchases"]
        out["parts_purchases_after_sale"] = s2["parts_purchases"]
        out["parts_purchases_delta_from_baseline"] = round(s2["parts_purchases"] - s0["parts_purchases"], 2)
        out["parts_sales_delta"] = round(s2["parts_sales"] - s0["parts_sales"], 2)
        out["total_sales_delta"] = round(s2["total_sales"] - s0["total_sales"], 2)
        out["cogs_delta"] = round(s2["cogs"] - s0["cogs"], 2)
        out["closing_stock_delta"] = round(s2["closing_stock"] - s0["closing_stock"], 2)
        # ASSERT expectations
        out["PASS_purchases_not_decrease_after_sale"] = (s2["parts_purchases"] >= s1["parts_purchases"])
        out["PASS_purchases_includes_100k"] = (out["parts_purchases_delta_from_baseline"] == 100000)
        out["PASS_sales_110k"] = (out["parts_sales_delta"] == 110000)
        out["PASS_cogs_100k"] = (out["cogs_delta"] == 100000)
        out["PASS_gross_10k"] = (out["total_sales_delta"] - out["cogs_delta"] == 10000)
    finally:
        for iid in created["invoices"]:
            requests.delete(f"{BASE}/invoices/{iid}", headers=H)
        for pid in created["parts"]:
            requests.delete(f"{BASE}/parts/{pid}", headers=H)
        for cid in created["customers"]:
            requests.delete(f"{BASE}/customers/{cid}", headers=H)
    return out


if __name__ == "__main__":
    comp = sys.argv[1] if len(sys.argv) > 1 else "MTC"
    print(json.dumps(run(comp), indent=2))
