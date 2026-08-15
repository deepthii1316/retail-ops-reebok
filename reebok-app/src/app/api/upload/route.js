import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { generateFileName, getStoragePath, getRawTableName, BUCKET_NAME } from '@/lib/fileRename';
import * as XLSX from 'xlsx';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const reportType = formData.get('reportType');
    const sha256 = formData.get('sha256');
    const originalFileName = formData.get('originalFileName');

    // Validate inputs
    if (!file || !reportType || !sha256) {
      return NextResponse.json(
        { error: 'Missing required fields: file, reportType, sha256' },
        { status: 400 }
      );
    }

    const validTypes = ['sales', 'inventory', 'account_dsr'];
    if (!validTypes.includes(reportType)) {
      return NextResponse.json(
        { error: `Invalid report type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // ─── Step 1: Dedup check ───────────────────────────────
    const { data: existing } = await supabase
      .from('upload_audit_log')
      .select('*')
      .eq('file_sha256', sha256)
      .single();

    if (existing) {
      return NextResponse.json(
        {
          error: 'Duplicate file — this exact file has already been uploaded.',
          duplicateInfo: {
            uploaded_at: existing.uploaded_at,
            renamed_file_name: existing.renamed_file_name,
            report_type: existing.report_type,
          },
        },
        { status: 409 }
      );
    }

    // ─── Step 2: Rename file ───────────────────────────────
    const renamedFileName = generateFileName(reportType);
    const storagePath = getStoragePath(reportType, renamedFileName);

    // ─── Step 3: Read file buffer ──────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileSize = buffer.length;

    // ─── Step 4: Create audit log entry (status: processing) ──
    const { data: auditEntry, error: auditError } = await supabase
      .from('upload_audit_log')
      .insert({
        file_sha256: sha256,
        original_file_name: originalFileName || file.name,
        renamed_file_name: renamedFileName,
        report_type: reportType,
        storage_path: storagePath,
        file_size_bytes: fileSize,
        uploaded_by: 'admin',
        status: 'processing',
      })
      .select()
      .single();

    if (auditError) {
      // Could be a race condition duplicate
      if (auditError.code === '23505') {
        return NextResponse.json(
          { error: 'Duplicate file — upload blocked (concurrent upload detected).' },
          { status: 409 }
        );
      }
      throw new Error(`Audit log insert failed: ${auditError.message}`);
    }

    try {
      // ─── Step 5: Upload to Supabase Storage ───────────────
      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, buffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        });

      if (storageError) {
        throw new Error(`Storage upload failed: ${storageError.message}`);
      }

      // ─── Step 6: Parse Excel ──────────────────────────────
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Skip title block/metadata rows for sales report (actual headers at row index 7)
      const rangeOption = reportType === 'sales' ? 7 : 0;

      // Convert to JSON — all values as strings
      const rawData = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: false, // Force string conversion
        range: rangeOption,
      });

      if (!rawData || rawData.length === 0) {
        throw new Error('No data rows found in the Excel file.');
      }

      // Helper to format date strings to DD-MM-YYYY format
      const formatBillDate = (dateStr) => {
        if (!dateStr) return null;
        const trimmed = String(dateStr).trim();
        if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return trimmed;
        try {
          const d = new Date(trimmed);
          if (!isNaN(d.getTime())) {
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}-${mm}-${yyyy}`;
          }
        } catch (e) {}
        return trimmed;
      };

      // Column mapping to align Excel columns with database table schemas
      const mapRecordColumns = (row, type) => {
        const mapped = {};
        if (type === 'sales') {
          mapped['Store Number'] = row['Store Number'] == null ? null : String(row['Store Number']).trim();
          mapped['Store Name'] = row['Store Name'] == null ? null : String(row['Store Name']).trim();
          mapped['SAP Code'] = (row['SAP CODE'] ?? row['SAP Code']) == null ? null : String(row['SAP CODE'] ?? row['SAP Code']).trim();
          mapped['Bar Code'] = (row['Stock No.'] ?? row['Bar Code']) == null ? null : String(row['Stock No.'] ?? row['Bar Code']).trim();
          mapped['Item Description'] = row['Item Description'] == null ? null : String(row['Item Description']).trim();
          mapped['Size'] = (row['Size Code'] ?? row['Size']) == null ? null : String(row['Size Code'] ?? row['Size']).trim();
          mapped['MRP'] = row['MRP'] == null ? null : String(row['MRP']).trim();
          mapped['Bill No.'] = row['Bill No.'] == null ? null : String(row['Bill No.']).trim();
          mapped['Bill Date'] = formatBillDate(row['Bill Date']);
          mapped['Qty'] = (row['Quantity'] ?? row['Qty']) == null ? null : String(row['Quantity'] ?? row['Qty']).trim();
          mapped['Disc %'] = (row['Total Discount'] ?? row['Disc %']) == null ? null : String(row['Total Discount'] ?? row['Disc %']).trim();
          mapped['Value'] = row['Value'] == null ? null : String(row['Value']).trim();
          mapped['CGST'] = (row['CGST Value'] ?? row['CGST']) == null ? null : String(row['CGST Value'] ?? row['CGST']).trim();
          mapped['SGST'] = (row['SGST Value'] ?? row['SGST']) == null ? null : String(row['SGST Value'] ?? row['SGST']).trim();
          mapped['IGST'] = (row['IGST Value'] ?? row['IGST']) == null ? null : String(row['IGST Value'] ?? row['IGST']).trim();
          mapped['Taxable Amount'] = row['Taxable Amount'] == null ? null : String(row['Taxable Amount']).trim();
          mapped['Brand'] = (row['DIVISION'] ?? row['Brand']) == null ? null : String(row['DIVISION'] ?? row['Brand']).trim();
          mapped['Section'] = (row['GROUP'] ?? row['Section']) == null ? null : String(row['GROUP'] ?? row['Section']).trim();
          mapped['Category'] = (row['Department'] ?? row['Category']) == null ? null : String(row['Department'] ?? row['Category']).trim();

          // Missing analytical columns mapped from raw source fields
          mapped['Region'] = row['Region'] == null ? null : String(row['Region']).trim();
          mapped['State Name'] = row['State Name'] == null ? null : String(row['State Name']).trim();
          mapped['Store GSTIN'] = row['Store GSTIN'] == null ? null : String(row['Store GSTIN']).trim();
          mapped['Salesman'] = row['Salesman'] == null ? null : String(row['Salesman']).trim();
          mapped['Sales Promo Code'] = row['Sales Promo Code'] == null ? null : String(row['Sales Promo Code']).trim();
          mapped['Sales Promo Description'] = row['Sales Promo Description'] == null ? null : String(row['Sales Promo Description']).trim();
          mapped['HSN Code'] = row['HSN Code'] == null ? null : String(row['HSN Code']).trim();
          mapped['Style Code'] = row['Style Code'] == null ? null : String(row['Style Code']).trim();
          mapped['Item Division'] = row['Item Division'] == null ? null : String(row['Item Division']).trim();
          mapped['Class Name'] = row['Class Name'] == null ? null : String(row['Class Name']).trim();
          mapped['Sub Class'] = row['Sub Class'] == null ? null : String(row['Sub Class']).trim();
        } else if (type === 'inventory') {
          mapped['Store Number'] = row['Store Number'] == null ? null : String(row['Store Number']).trim();
          mapped['Store Name'] = row['Store Name'] == null ? null : String(row['Store Name']).trim();
          mapped['SAP Code'] = (row['SAP CODE'] ?? row['SAP Code']) == null ? null : String(row['SAP CODE'] ?? row['SAP Code']).trim();
          mapped['Bar Code'] = (row['Stock No.'] ?? row['Bar Code']) == null ? null : String(row['Stock No.'] ?? row['Bar Code']).trim();
          mapped['Item Description'] = row['Item Description'] == null ? null : String(row['Item Description']).trim();
          mapped['Size'] = (row['Size Code'] ?? row['Size']) == null ? null : String(row['Size Code'] ?? row['Size']).trim();
          mapped['MRP'] = row['MRP'] == null ? null : String(row['MRP']).trim();
          mapped['Stock Qty'] = (row['Stock Qty'] ?? row['Quantity'] ?? row['Qty']) == null ? null : String(row['Stock Qty'] ?? row['Quantity'] ?? row['Qty']).trim();
          mapped['Stock Value'] = (row['Stock Value'] ?? row['Value']) == null ? null : String(row['Stock Value'] ?? row['Value']).trim();
          mapped['Brand'] = (row['DIVISION'] ?? row['Brand']) == null ? null : String(row['DIVISION'] ?? row['Brand']).trim();
          mapped['Section'] = (row['GROUP'] ?? row['Section']) == null ? null : String(row['GROUP'] ?? row['Section']).trim();
          mapped['Category'] = (row['Department'] ?? row['Category']) == null ? null : String(row['Department'] ?? row['Category']).trim();
        } else if (type === 'account_dsr') {
          mapped['Date'] = (row['Date'] ?? row['Bill Date']) == null ? null : String(row['Date'] ?? row['Bill Date']).trim();
          mapped['Store Number'] = row['Store Number'] == null ? null : String(row['Store Number']).trim();
          mapped['Store Name'] = row['Store Name'] == null ? null : String(row['Store Name']).trim();
          mapped['Total Bills'] = row['Total Bills'] == null ? null : String(row['Total Bills']).trim();
          mapped['Total Sales'] = (row['Total Sales'] ?? row['Value']) == null ? null : String(row['Total Sales'] ?? row['Value']).trim();
          mapped['Cash Amount'] = row['Cash Amount'] == null ? null : String(row['Cash Amount']).trim();
          mapped['Cash Bills'] = row['Cash Bills'] == null ? null : String(row['Cash Bills']).trim();
          mapped['Card Amount'] = row['Card Amount'] == null ? null : String(row['Card Amount']).trim();
          mapped['Card Bills'] = row['Card Bills'] == null ? null : String(row['Card Bills']).trim();
          mapped['UPI Amount'] = row['UPI Amount'] == null ? null : String(row['UPI Amount']).trim();
          mapped['UPI Bills'] = row['UPI Bills'] == null ? null : String(row['UPI Bills']).trim();
          mapped['Other Amount'] = row['Other Amount'] == null ? null : String(row['Other Amount']).trim();
          mapped['Other Bills'] = row['Other Bills'] == null ? null : String(row['Other Bills']).trim();
        } else {
          return row;
        }
        return mapped;
      };

      // ─── Step 7: Prepare records with audit columns ───────
      const now = new Date().toISOString();
      const records = rawData.map((row) => {
        // Map columns according to the database table schema
        const mappedRow = mapRecordColumns(row, reportType);

        // Add audit columns
        mappedRow.uploaded_at = now;
        mappedRow.uploaded_by = 'admin';
        mappedRow.source_file_name = renamedFileName;
        mappedRow.ingestion_method = 'manual';
        return mappedRow;
      });

      // Filter out empty rows & sales footer summary rows (which lack Store Number)
      const validRecords = records.filter((r) => {
        if (reportType === 'sales' || reportType === 'inventory') {
          if (r['Store Number'] == null || r['Store Number'] === '' || r['Store Number'] === 'nan' || r['Store Number'] === 'None') {
            return false;
          }
        }
        const sourceKeys = Object.keys(r).filter(
          (k) => !['uploaded_at', 'uploaded_by', 'source_file_name', 'ingestion_method'].includes(k)
        );
        return sourceKeys.some((k) => r[k] != null && r[k] !== '');
      });

      // ─── Step 8: Insert into raw table ────────────────────
      const tableName = getRawTableName(reportType);

      // Insert in batches of 500 to avoid payload limits
      const BATCH_SIZE = 500;
      let totalInserted = 0;

      for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
        const batch = validRecords.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase
          .schema('raw')
          .from(tableName)
          .insert(batch);

        if (insertError) {
          throw new Error(
            `Data insert failed at batch ${Math.floor(i / BATCH_SIZE) + 1}: ${insertError.message}`
          );
        }
        totalInserted += batch.length;
      }

      // ─── Step 9: Update audit log → success ───────────────
      await supabase
        .from('upload_audit_log')
        .update({
          status: 'success',
          row_count: totalInserted,
        })
        .eq('id', auditEntry.id);

      return NextResponse.json({
        success: true,
        renamedFileName,
        storagePath,
        rowCount: totalInserted,
        message: `Inserted ${totalInserted} rows into raw.${tableName}`,
      });
    } catch (processingError) {
      // Update audit log → failed
      await supabase
        .from('upload_audit_log')
        .update({
          status: 'failed',
          error_message: processingError.message,
        })
        .eq('id', auditEntry.id);

      throw processingError;
    }
  } catch (error) {
    console.error('Upload API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
