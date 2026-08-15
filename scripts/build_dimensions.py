import os
import sys
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_KEY")

# Fallback: check inside reebok-app/.env.local
if not supabase_url or not supabase_key:
    from pathlib import Path
    env_local = Path(__file__).resolve().parent.parent / "reebok-app" / ".env.local"
    if env_local.exists():
        with open(env_local, "r") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    if k == "NEXT_PUBLIC_SUPABASE_URL" and not supabase_url:
                        supabase_url = v
                    elif k == "SUPABASE_SERVICE_ROLE_KEY" and not supabase_key:
                        supabase_key = v

if not supabase_url or not supabase_key:
    print("Error: Supabase connection credentials not found in env.")
    sys.exit(1)


def build_dimensions():
    print("Connecting to Supabase...")
    supabase = create_client(supabase_url, supabase_key)

    # ─── Fetch raw sales data ──────────────────────────────────────────
    print("Fetching raw sales records...")
    # Fetch in pages of 1000 since Postgrest limits queries to 1000 rows
    all_raw = []
    limit = 1000
    offset = 0
    while True:
        res = supabase.schema("raw").table("sales").select("*").range(offset, offset + limit - 1).execute()
        data = res.data
        if not data:
            break
        all_raw.extend(data)
        if len(data) < limit:
            break
        offset += limit

    print(f"Retrieved {len(all_raw)} raw sales rows.")
    if not all_raw:
        print("No raw sales rows found. Aborting dimension building.")
        sys.exit(0)

    # Convert to pandas DataFrame for easy cleaning and grouping
    df = pd.DataFrame(all_raw)

    def clean_str(val, casing=None):
        if val is None or pd.isna(val):
            return None
        s = str(val).strip()
        if s in ["", "nan", "None", "<NA>"]:
            return None
        if casing == "title":
            return s.title()
        elif casing == "upper":
            return s.upper()
        elif casing == "lower":
            return s.lower()
        return s

    # ─── 1. Stores (dim_store) ─────────────────────────────────────────
    print("Building Store Dimension (dim_store)...")
    # Filter rows with store number, requiring a valid SAP Code to discard summary footer rows
    store_df = df[df["Store Number"].notna() & df["SAP Code"].notna() & ~df["Store Number"].isin(["Total", "Grand Total"])]
    # Extract distinct stores
    store_cols = ["Store Number", "SAP Code", "Store Name", "Region", "State Name", "Store GSTIN"]
    stores_unique = store_df[store_cols].drop_duplicates(subset=["Store Number"])

    store_records = []
    for _, r in stores_unique.iterrows():
        store_records.append({
            "store_number": clean_str(r["Store Number"]),
            "sap_code": clean_str(r["SAP Code"]),
            "store_name": clean_str(r["Store Name"], "title"),
            "region": clean_str(r["Region"], "title"),
            "state": clean_str(r["State Name"], "upper"),
            "store_gstin": clean_str(r["Store GSTIN"], "upper")
        })

    print(f"Cleaned {len(store_records)} unique stores.")

    # ─── 2. Salespeople (dim_salesperson) ────────────────────────────────
    print("Building Salesperson Dimension (dim_salesperson)...")
    salesperson_df = df[df["Salesman"].notna()]
    salespeople_unique = salesperson_df["Salesman"].unique()

    salesperson_records = []
    for s_name in salespeople_unique:
        cleaned_name = clean_str(s_name, "title")
        if cleaned_name:
            salesperson_records.append({
                "salesperson_name": cleaned_name,
                "status": "Active"
            })

    print(f"Cleaned {len(salesperson_records)} unique salespeople.")

    # ─── 3. Promotions (dim_promotion) ──────────────────────────────────
    print("Building Promotion Dimension (dim_promotion)...")
    promo_df = df[df["Sales Promo Code"].notna()]
    promo_unique = promo_df[["Sales Promo Code", "Sales Promo Description"]].drop_duplicates(subset=["Sales Promo Code"])

    promo_records = []
    # Always insert a default "No Promotion" row first
    promo_records.append({
        "promo_key": 0,
        "promo_code": "NO_PROMO",
        "promo_description": "No Promotion"
    })

    for _, r in promo_unique.iterrows():
        code = clean_str(r["Sales Promo Code"])
        if code and code != "NO_PROMO":
            promo_records.append({
                "promo_code": code,
                "promo_description": clean_str(r["Sales Promo Description"], "title")
            })

    print(f"Cleaned {len(promo_records)} unique promotions (including NO_PROMO).")

    # ─── 4. Products (dim_product) ─────────────────────────────────────
    print("Building Product Dimension (dim_product)...")
    product_df = df[df["Bar Code"].notna()]
    product_cols = [
        "Bar Code", "Style Code", "Item Description", "Item Division", 
        "Brand", "Section", "Category", "Class Name", "Sub Class", 
        "Size", "HSN Code", "MRP"
    ]
    products_unique = product_df[product_cols].drop_duplicates(subset=["Bar Code"])

    product_records = []
    for _, r in products_unique.iterrows():
        product_records.append({
            "barcode": clean_str(r["Bar Code"]),
            "style_code": clean_str(r["Style Code"]),
            "item_description": clean_str(r["Item Description"]),
            "item_division": clean_str(r["Item Division"], "title"),
            "division": clean_str(r["Brand"], "title"),
            "group_name": clean_str(r["Section"], "title"),
            "department": clean_str(r["Category"], "title"),
            "class_name": clean_str(r["Class Name"], "title"),
            "sub_class": clean_str(r["Sub Class"], "title"),
            "size_code": clean_str(r["Size"]),
            "hsn_code": clean_str(r["HSN Code"]),
            "mrp": clean_str(r["MRP"])
        })

    print(f"Cleaned {len(product_records)} unique products.")

    # ─── Write to Supabase Staging Tables ────────────────────────────────
    print("\n--- Clearing staging dimension tables ---")
    supabase.schema("staging").table("dim_product").delete().neq("barcode", "DUMMY_NONE").execute()
    supabase.schema("staging").table("dim_store").delete().neq("store_number", "DUMMY_NONE").execute()
    supabase.schema("staging").table("dim_salesperson").delete().neq("salesperson_name", "DUMMY_NONE").execute()
    supabase.schema("staging").table("dim_promotion").delete().neq("promo_code", "DUMMY_NONE").execute()

    print("Populating dim_store...")
    if store_records:
        supabase.schema("staging").table("dim_store").insert(store_records).execute()

    print("Populating dim_salesperson...")
    if salesperson_records:
        supabase.schema("staging").table("dim_salesperson").insert(salesperson_records).execute()

    print("Populating dim_promotion...")
    if promo_records:
        # Split default promo insert (explicit key=0) from other promos (auto-generated key)
        # to prevent Postgrest batch payload null-padding validation issues
        default_promo = [r for r in promo_records if r.get("promo_key") == 0]
        other_promos = [r for r in promo_records if r.get("promo_key") != 0]

        if default_promo:
            supabase.schema("staging").table("dim_promotion").insert(default_promo).execute()
        if other_promos:
            supabase.schema("staging").table("dim_promotion").insert(other_promos).execute()

    print("Populating dim_product...")
    if product_records:
        # Batch insert products to avoid large payloads
        P_BATCH_SIZE = 100
        for i in range(0, len(product_records), P_BATCH_SIZE):
            batch = product_records[i:i+P_BATCH_SIZE]
            supabase.schema("staging").table("dim_product").insert(batch).execute()

    print("\nAnalytics Dimensions built successfully!")


if __name__ == "__main__":
    build_dimensions()
