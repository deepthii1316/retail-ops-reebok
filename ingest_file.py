import os
import sys
import pandas as pd
from supabase import create_client
from datetime import datetime, timezone
from dotenv import load_dotenv
from pathlib import Path

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

def ingest_file(filepath, uploaded_by):
    df = pd.read_excel(filepath, dtype=str, header=7)
    df = df.loc[:, ~df.columns.str.contains('^Unnamed')]
    df.columns = df.columns.str.strip()
    
    df = df[df['Store Number'].notna()]   # drop footer/summary rows
    
    df['Bill Date'] = pd.to_datetime(df['Bill Date']).dt.strftime('%d-%m-%Y')
    
    

    # Convert records and sanitize NaN/float empty values to None (valid JSON nulls)
    raw_records = df.to_dict(orient='records')
    records = []
    for r in raw_records:
        clean_row = {}
        for k, v in r.items():
            if pd.isna(v) or (isinstance(v, float) and (v != v)):
                clean_row[k] = None
            else:
                clean_row[k] = str(v)
        clean_row['uploaded_at'] = datetime.now(timezone.utc).isoformat()
        clean_row['uploaded_by'] = uploaded_by
        clean_row['source_file_name'] = os.path.basename(filepath)
        clean_row['ingestion_method'] = 'manual'
        records.append(clean_row)

    supabase = create_client(supabase_url, supabase_key)
    res = supabase.schema('raw').table('raw_sap_reebok_sales').insert(records).execute()
    print(f"Successfully inserted {len(records)} records into raw.raw_sap_reebok_sales!")

if __name__ == "__main__":
    filepath_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    filepath = resolve_filepath(filepath_arg)
    uploaded_by = sys.argv[2] if len(sys.argv) > 2 else "deepthi"
    ingest_file(filepath=filepath, uploaded_by=uploaded_by)