'use client';

import { useRef, useState, useCallback } from 'react';

export default function FileDropZone({
  selectedType,
  file,
  onFileSelect,
  onFileRemove,
  sha256,
  isHashing,
  isDuplicate,
  duplicateInfo,
  renamedFileName,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) onFileSelect(dropped);
    },
    [onFileSelect]
  );

  const handleBrowse = () => inputRef.current?.click();

  const handleInputChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) onFileSelect(selected);
    e.target.value = '';
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // No report type selected
  if (!selectedType) {
    return (
      <div className="drop-zone-container">
        <div className="no-report-selected">
          <span className="empty-icon">📂</span>
          <p>No report selected</p>
          <p style={{ fontSize: '12px' }}>Choose a report type above, then add a file.</p>
        </div>
      </div>
    );
  }

  // File selected — show preview
  if (file) {
    return (
      <div className="file-preview">
        {/* File info */}
        <div className="file-info-row">
          <div className="file-icon">📄</div>
          <div className="file-details">
            <div className="file-name">{file.name}</div>
            <div className="file-meta">
              <span>{formatSize(file.size)}</span>
              <span>•</span>
              <span>{file.type || 'application/vnd.ms-excel'}</span>
            </div>
          </div>
          <button
            className="file-remove-btn"
            onClick={onFileRemove}
            title="Remove file"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* Rename preview */}
        {renamedFileName && !isDuplicate && (
          <div className="rename-preview">
            <span className="rename-label">Renamed to</span>
            <span className="rename-arrow">→</span>
            <span className="rename-name">{renamedFileName}</span>
          </div>
        )}

        {/* SHA hash */}
        {isHashing ? (
          <div className="sha-computing">
            <div className="spinner dark" />
            <span>Computing SHA-256 hash…</span>
          </div>
        ) : sha256 ? (
          <div className="sha-hash">
            <span className="sha-label">SHA-256</span>
            <span>{sha256}</span>
          </div>
        ) : null}

        {/* Duplicate warning */}
        {isDuplicate && duplicateInfo && (
          <div className="duplicate-warning">
            <span className="warning-icon">⚠️</span>
            <div className="warning-text">
              <strong>Duplicate file detected — upload blocked</strong>
              This exact file was already uploaded on{' '}
              {new Date(duplicateInfo.uploaded_at).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              as &quot;{duplicateInfo.renamed_file_name}&quot;.
              Same content cannot be uploaded twice.
            </div>
          </div>
        )}
      </div>
    );
  }

  // Drop zone
  return (
    <div className="drop-zone-container">
      <div
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowse}
        role="button"
        tabIndex={0}
      >
        <span className="drop-zone-icon">📂</span>
        <div className="drop-zone-text">
          <p>
            Drag & drop your file here, or{' '}
            <span className="browse-link">browse</span>
          </p>
        </div>
        <span className="drop-zone-hint">.xlsx or .xls files only</span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
