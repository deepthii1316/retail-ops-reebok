import os
import sys
import pandas as pd
import hashlib
from supabase import create_client
from datetime import datetime, timezone
from dotenv import load_dotenv
from pathlib import Path
from storage3.types import FileOptions

load_dotenv()
supabase_url = os.environ["SUPABASE_URL"]
supabase_key = os.environ["SUPABASE_KEY"]


def resolve_filepath(cli_filepath):
    filepath = (cli_filepath or "").strip()
    if filepath:
        return filepath

    data_dir = Path(__file__).resolve().parent / "data"
    xlsx_files = sorted(data_dir.glob("*.xlsx"))
    if not xlsx_files:
        raise FileNotFoundError(f"No .xlsx files found in {data_dir}")
    return str(xlsx_files[0])


def calculate_sha256(filepath):
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def generate_file_name(report_type, dt=None):
    if dt is None:
        dt = datetime.now()
    yyyy = dt.year
    MM = f"{dt.month:02d}"
    dd = f"{dt.day:02d}"
    HH = f"{dt.hour:02d}"
    mm = f"{dt.minute:02d}"
    ss = f"{dt.second:02d}"
    type_part = report_type.replace("-", "_")
    return f"{type_part}_{yyyy}_{MM}_{dd}_{HH}{mm}{ss}.xlsx"


def ingest_file(filepath, uploaded_by):
    file_hash = calculate_sha256(filepath)
    file_size = os.path.getsize(filepath)
    original_name = os.path.basename(filepath)

    print(f"File: {original_name}")
    print(f"Size: {file_size} bytes")
    print(f"Calculated SHA-256: {file_hash}")

    supabase = create_client(supabase_url, supabase_key)

    # Check for duplicate in upload_audit_log
    existing = supabase.table("upload_audit_log").select("*").eq("file_sha256", file_hash).execute()
    if existing.data:
        audit = existing.data[0]
        print(f"Duplicate file detected! Uploaded at {audit['uploaded_at']} as '{audit['renamed_file_name']}'.")
        print("Aborting ingestion (upload blocked).")
        sys.exit(0)

    # Generate target filename and storage path
    renamed_name = generate_file_name("sales")
    storage_path = f"raw/sales/{renamed_name}"

    # Create audit log entry with status 'processing'
    audit_entry = supabase.table("upload_audit_log").insert({
        "file_sha256": file_hash,
        "original_file_name": original_name,
        "renamed_file_name": renamed_name,
        "report_type": "sales",
        "storage_path": storage_path,
        "file_size_bytes": file_size,
        "uploaded_by": uploaded_by,
        "status": "processing"
    }).execute()

    audit_id = audit_entry.data[0]["id"]

    try:
        # Upload original file to Supabase Storage
        print(f"Uploading to storage: {storage_path} ...")
        with open(filepath, 'rb') as f:
            supabase.storage.from_("retail-ops").upload(
                path=storage_path,
                file=f,
                file_options=FileOptions(
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    upsert=False
                )
            )

        # Parse Excel
        print("Parsing Excel workbook...")
        df = pd.read_excel(filepath, dtype=str, header=7)
        df = df.loc[:, ~df.columns.str.contains('^Unnamed')]
        df.columns = df.columns.str.strip()

        # Drop footer/summary rows
        df = df[df['Store Number'].notna()]

        # Reformat dates (Hard Rule #1)
        df['Bill Date'] = pd.to_datetime(df['Bill Date']).dt.strftime('%d-%m-%Y')

        raw_records = df.to_dict(orient='records')
        records = []
        now_str = datetime.now(timezone.utc).isoformat()

        for r in raw_records:
            # Map columns according to raw.sales schema
            clean_row = {}

            # Strip spaces and map fields safely (converting float NaN to None)
            def get_val(key_list):
                for k in key_list:
                    v = r.get(k)
                    if v is not None and not (isinstance(v, float) and pd.isna(v)) and str(v) != 'nan':
                        return str(v).strip()
                return None

            clean_row['Store Number'] = get_val(['Store Number'])
            clean_row['Store Name'] = get_val(['Store Name'])
            clean_row['SAP Code'] = get_val(['SAP CODE', 'SAP Code'])
            clean_row['Bar Code'] = get_val(['Stock No.', 'Bar Code'])
            clean_row['Item Description'] = get_val(['Item Description'])
            clean_row['Size'] = get_val(['Size Code', 'Size'])
            clean_row['MRP'] = get_val(['MRP'])
            clean_row['Bill No.'] = get_val(['Bill No.'])
            clean_row['Bill Date'] = get_val(['Bill Date'])
            clean_row['Qty'] = get_val(['Quantity', 'Qty'])
            clean_row['Disc %'] = get_val(['Total Discount', 'Disc %'])
            clean_row['Value'] = get_val(['Value'])
            clean_row['CGST'] = get_val(['CGST Value', 'CGST'])
            clean_row['SGST'] = get_val(['SGST Value', 'SGST'])
            clean_row['IGST'] = get_val(['IGST Value', 'IGST'])
            clean_row['Taxable Amount'] = get_val(['Taxable Amount'])
            clean_row['Brand'] = get_val(['DIVISION', 'Brand'])
            clean_row['Section'] = get_val(['GROUP', 'Section'])
            clean_row['Category'] = get_val(['Department', 'Category'])

            # New analytical columns mapped from raw source fields
            clean_row['Region'] = get_val(['Region'])
            clean_row['State Name'] = get_val(['State Name'])
            clean_row['Store GSTIN'] = get_val(['Store GSTIN'])
            clean_row['Salesman'] = get_val(['Salesman'])
            clean_row['Sales Promo Code'] = get_val(['Sales Promo Code'])
            clean_row['Sales Promo Description'] = get_val(['Sales Promo Description'])
            clean_row['HSN Code'] = get_val(['HSN Code'])
            clean_row['Style Code'] = get_val(['Style Code'])
            clean_row['Item Division'] = get_val(['Item Division'])
            clean_row['Class Name'] = get_val(['Class Name'])
            clean_row['Sub Class'] = get_val(['Sub Class'])

            # Add inline audit columns
            clean_row['uploaded_at'] = now_str
            clean_row['uploaded_by'] = uploaded_by
            clean_row['source_file_name'] = renamed_name
            clean_row['ingestion_method'] = 'manual'

            records.append(clean_row)

        # Insert in batches of 500
        BATCH_SIZE = 500
        total_inserted = 0
        print(f"Inserting {len(records)} records into raw.sales...")

        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i+BATCH_SIZE]
            supabase.schema('raw').table('sales').insert(batch).execute()
            total_inserted += len(batch)

        # Update audit log to success
        supabase.table("upload_audit_log").update({
            "status": "success",
            "row_count": total_inserted
        }).eq("id", audit_id).execute()

        print(f"Successfully ingested {total_inserted} records into raw.sales!")

    except Exception as e:
        print(f"Ingestion failed: {str(e)}")
        # Try to mark audit log as failed
        try:
            supabase.table("upload_audit_log").update({
                "status": "failed",
                "error_message": str(e)
            }).eq("id", audit_id).execute()
        except Exception as update_err:
            print(f"Failed to update audit log error: {str(update_err)}")
        sys.exit(1)


if __name__ == "__main__":
    filepath_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    filepath = resolve_filepath(filepath_arg)
    uploaded_by = sys.argv[2] if len(sys.argv) > 2 else "deepthi"
    ingest_file(filepath=filepath, uploaded_by=uploaded_by)