'use client';

export default function UploadHistory({ uploads, loading }) {
  if (loading) {
    return (
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <span className="card-header-icon">🕐</span>
          <h3>Recent Uploads</h3>
        </div>
        <div className="history-empty">
          <div className="spinner dark" />
          <p>Loading upload history…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '24px' }}>
      <div className="card-header">
        <span className="card-header-icon">🕐</span>
        <h3>Recent Uploads</h3>
      </div>

      {!uploads || uploads.length === 0 ? (
        <div className="history-empty">
          <span className="empty-icon">📋</span>
          <p>No uploads yet</p>
        </div>
      ) : (
        <div className="history-table-wrapper">
          <table className="history-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Rows</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td className="file-name-cell" title={u.renamed_file_name}>
                    {u.renamed_file_name}
                  </td>
                  <td className="type-cell">
                    {u.report_type === 'account_dsr' ? 'Account DSR' : u.report_type}
                  </td>
                  <td className="rows-cell">{u.row_count?.toLocaleString() || '—'}</td>
                  <td>
                    {u.file_size_bytes
                      ? `${(u.file_size_bytes / 1024).toFixed(0)} KB`
                      : '—'}
                  </td>
                  <td>
                    {u.uploaded_at
                      ? new Date(u.uploaded_at).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                  <td>
                    <span className={`status-badge ${u.status}`}>
                      <span className="status-dot" />
                      {u.status === 'success'
                        ? 'Success'
                        : u.status === 'failed'
                        ? 'Failed'
                        : 'Processing'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
