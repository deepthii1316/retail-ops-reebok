-- =============================================================
-- Reebok Data Upload Portal — Supabase Schema (v2)
-- =============================================================
-- Run this in the Supabase SQL Editor.
-- Prerequisites:
--   1. Create schema 'raw' if it doesn't exist
--   2. Add 'raw' to Project Settings → API → Exposed schemas
-- =============================================================

-- Ensure the raw schema exists
CREATE SCHEMA IF NOT EXISTS raw;

-- =============================================================
-- 1. PUBLIC.UPLOAD_AUDIT_LOG — Dedup & upload history
--    Lives in public schema (not raw). Tracks every upload
--    attempt with SHA-256 hash for duplicate detection.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.upload_audit_log (
    id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    file_sha256         text NOT NULL UNIQUE,
    original_file_name  text NOT NULL,
    renamed_file_name   text NOT NULL,
    report_type         text NOT NULL CHECK (report_type IN ('sales', 'inventory', 'account_dsr')),
    storage_path        text,
    row_count           integer DEFAULT 0,
    file_size_bytes     bigint,
    uploaded_by         text NOT NULL DEFAULT 'admin',
    uploaded_at         timestamptz DEFAULT now(),
    status              text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'success', 'failed')),
    error_message       text
);

-- Fast SHA lookups during dedup check
CREATE INDEX IF NOT EXISTS idx_audit_log_sha256
    ON public.upload_audit_log (file_sha256);

-- Recent uploads listing
CREATE INDEX IF NOT EXISTS idx_audit_log_uploaded_at
    ON public.upload_audit_log (uploaded_at DESC);


-- =============================================================
-- 2. RAW.SALES — Bill-Wise Item List
-- =============================================================
-- Columns based on the SAP/Reebok export format.
-- All source columns stored as text — no type casting in raw.
CREATE TABLE IF NOT EXISTS raw.sales (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "Store Number"      text,
    "Store Name"        text,
    "SAP Code"          text,
    "Bar Code"          text,
    "Item Description"  text,
    "Size"              text,
    "MRP"               text,
    "Bill No."          text,
    "Bill Date"         text,
    "Qty"               text,
    "Disc %"            text,
    "Value"             text,
    "CGST"              text,
    "SGST"              text,
    "IGST"              text,
    "Taxable Amount"    text,
    "Brand"             text,
    "Section"           text,
    "Category"          text,
    "Region"            text,
    "State Name"        text,
    "Store GSTIN"       text,
    "Salesman"          text,
    "Sales Promo Code"  text,
    "Sales Promo Description" text,
    "HSN Code"          text,
    "Style Code"        text,
    "Item Division"     text,
    "Class Name"        text,
    "Sub Class"         text,
    -- Inline audit columns
    uploaded_at         text NOT NULL,
    uploaded_by         text NOT NULL,
    source_file_name    text NOT NULL,
    ingestion_method    text NOT NULL DEFAULT 'manual'
);


-- =============================================================
-- 3. RAW.INVENTORY — Stock Item Report
-- =============================================================
-- Column list is a best-guess. Will be refined with sample file.
CREATE TABLE IF NOT EXISTS raw.inventory (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "Store Number"      text,
    "Store Name"        text,
    "SAP Code"          text,
    "Bar Code"          text,
    "Item Description"  text,
    "Size"              text,
    "MRP"               text,
    "Stock Qty"         text,
    "Stock Value"       text,
    "Brand"             text,
    "Section"           text,
    "Category"          text,
    -- Inline audit columns
    uploaded_at         text NOT NULL,
    uploaded_by         text NOT NULL,
    source_file_name    text NOT NULL,
    ingestion_method    text NOT NULL DEFAULT 'manual'
);


-- =============================================================
-- 4. RAW.ACCOUNT_DSR — Payment Mode Split
-- =============================================================
-- Daily sales register with UPI/Cash/Card breakdown.
-- Column list is a best-guess. Will be refined with sample file.
CREATE TABLE IF NOT EXISTS raw.account_dsr (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "Date"              text,
    "Store Number"      text,
    "Store Name"        text,
    "Total Bills"       text,
    "Total Sales"       text,
    "Cash Amount"       text,
    "Cash Bills"        text,
    "Card Amount"       text,
    "Card Bills"        text,
    "UPI Amount"        text,
    "UPI Bills"         text,
    "Other Amount"      text,
    "Other Bills"       text,
    -- Inline audit columns
    uploaded_at         text NOT NULL,
    uploaded_by         text NOT NULL,
    source_file_name    text NOT NULL,
    ingestion_method    text NOT NULL DEFAULT 'manual'
);


-- =============================================================
-- STORAGE BUCKET (create via Supabase Dashboard)
-- =============================================================
-- Bucket name: retail-ops
-- Private bucket (not public)
-- Folder structure (managed by the app):
--
--   retail-ops/
--   ├── archive/          (future use)
--   ├── errors/           (future use)
--   ├── processed/        (future use)
--   └── raw/
--       ├── sales/        → sales_2026_08_08_134500.xlsx
--       ├── inventory/    → inventory_2026_08_08_134500.xlsx
--       └── account-dsr/  → account_dsr_2026_08_08_134500.xlsx


-- =============================================================
-- DATABASE GRANTS & PERMISSIONS (run in SQL Editor)
-- =============================================================
-- Grant usage on raw schema to API roles
GRANT USAGE ON SCHEMA raw TO postgres, anon, authenticated, service_role;

-- Grant privileges on all existing tables in raw schema
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA raw TO postgres, anon, authenticated, service_role;

-- Ensure future tables in raw schema get these privileges automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA raw GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;


-- =============================================================
-- Reebok Data Upload Portal — Staging Schema (Medallion Silver)
-- =============================================================

-- Ensure the staging schema exists
CREATE SCHEMA IF NOT EXISTS staging;

-- Grant usage on staging schema to API roles
GRANT USAGE ON SCHEMA staging TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA staging TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA staging GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

-- =============================================================
-- 1. STAGING.HOLIDAY_REFERENCE
-- =============================================================
-- Stores moving Indian holidays. Populated via Python script.
CREATE TABLE IF NOT EXISTS staging.holiday_reference (
    full_date       date PRIMARY KEY,
    holiday_name    text NOT NULL
);

-- =============================================================
-- 2. STAGING.DIM_DATE (Calendar Dimension)
-- =============================================================
-- Conformed calendar table with April-March Financial Year formatting.
CREATE TABLE IF NOT EXISTS staging.dim_date (
    date_key        integer PRIMARY KEY,
    full_date       date NOT NULL UNIQUE,
    day             integer NOT NULL,
    day_of_week     integer NOT NULL, -- 1 = Monday, 7 = Sunday
    week_of_year    integer NOT NULL,
    month           integer NOT NULL,
    month_name      text NOT NULL,
    quarter         integer NOT NULL,
    year            integer NOT NULL,
    financial_year  text NOT NULL, -- e.g. FY2025-26
    is_weekend      boolean NOT NULL,
    is_holiday      boolean NOT NULL DEFAULT false
);

-- =============================================================
-- 3. CALENDAR GENERATION QUERY
-- =============================================================
-- Generates calendar entries from 2026-01-01 to 2030-12-31.
INSERT INTO staging.dim_date (
    date_key,
    full_date,
    day,
    day_of_week,
    week_of_year,
    month,
    month_name,
    quarter,
    year,
    financial_year,
    is_weekend,
    is_holiday
)
SELECT
    to_char(d, 'YYYYMMDD')::integer as date_key,
    d::date as full_date,
    extract(day from d)::integer as day,
    extract(isodow from d)::integer as day_of_week, -- 1 = Monday, 7 = Sunday
    extract(week from d)::integer as week_of_year,
    extract(month from d)::integer as month,
    trim(to_char(d, 'Month')) as month_name,
    extract(quarter from d)::integer as quarter,
    extract(year from d)::integer as year,
    -- April-March Financial Year logic (India standard)
    CASE 
        WHEN extract(month from d) >= 4 THEN
            'FY' || extract(year from d)::text || '-' || substring((extract(year from d) + 1)::text from 3 for 2)
        ELSE
            'FY' || (extract(year from d) - 1)::text || '-' || substring(extract(year from d)::text from 3 for 2)
    END as financial_year,
    CASE 
        WHEN extract(isodow from d) IN (6, 7) THEN true
        ELSE false
    END as is_weekend,
    false as is_holiday
FROM generate_series('2026-01-01'::date, '2030-12-31'::date, '1 day'::interval) d
ON CONFLICT (date_key) DO NOTHING;
-- =============================================================
-- 4. STAGING.DIM_PRODUCT
-- =============================================================
CREATE TABLE IF NOT EXISTS staging.dim_product (
    product_key      integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    barcode          text NOT NULL UNIQUE,
    style_code       text,
    item_description text,
    item_division    text,
    division         text,
    group_name       text,
    department       text,
    class_name       text,
    sub_class        text,
    size_code        text,
    hsn_code         text,
    mrp              text
);

-- =============================================================
-- 5. STAGING.DIM_STORE
-- =============================================================
CREATE TABLE IF NOT EXISTS staging.dim_store (
    store_key        integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    store_number     text NOT NULL UNIQUE,
    sap_code         text,
    store_name       text,
    region           text,
    state            text,
    store_gstin      text
);

-- =============================================================
-- 6. STAGING.DIM_SALESPERSON
-- =============================================================
CREATE TABLE IF NOT EXISTS staging.dim_salesperson (
    salesperson_key  integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    salesperson_name text NOT NULL UNIQUE,
    status           text NOT NULL DEFAULT 'Active'
);

-- =============================================================
-- 7. STAGING.DIM_PROMOTION
-- =============================================================
CREATE TABLE IF NOT EXISTS staging.dim_promotion (
    promo_key        integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    promo_code       text NOT NULL UNIQUE,
    promo_description text
);
