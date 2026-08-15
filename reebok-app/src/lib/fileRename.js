/**
 * Generate a standardized filename for raw layer storage.
 *
 * Convention: <type>_YYYY_MM_DD_HHmmss.xlsx
 * Matches Skechers pattern: sales_2026_07_07_042258.xlsx
 *
 * @param {string} reportType - 'sales' | 'inventory' | 'account_dsr'
 * @param {Date}   [date]     - Timestamp for the filename (defaults to now)
 * @returns {string}
 */
export function generateFileName(reportType, date = new Date()) {
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const HH = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');

  const typePart = reportType.replace(/-/g, '_');
  return `${typePart}_${yyyy}_${MM}_${dd}_${HH}${mm}${ss}.xlsx`;
}

/**
 * Get the full storage path for a file in the retail-ops bucket.
 * Pattern: raw/<folder>/<filename>
 *
 * @param {string} reportType
 * @param {string} fileName
 * @returns {string}
 */
export function getStoragePath(reportType, fileName) {
  const folder = getStorageFolder(reportType);
  return `raw/${folder}/${fileName}`;
}

/**
 * Map report type to its storage subfolder name.
 */
export function getStorageFolder(reportType) {
  const folders = {
    sales: 'sales',
    inventory: 'inventory',
    account_dsr: 'account-dsr',
  };
  return folders[reportType] || reportType;
}

/**
 * Map report type to its raw schema table name.
 */
export function getRawTableName(reportType) {
  const tables = {
    sales: 'sales',
    inventory: 'inventory',
    account_dsr: 'account_dsr',
  };
  return tables[reportType];
}

/**
 * Bucket name — single bucket for all report types.
 */
export const BUCKET_NAME = 'retail-ops';
