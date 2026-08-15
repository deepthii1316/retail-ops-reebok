'use client';

import { useState, useEffect, useCallback } from 'react';
import ReportTypeSelector from '@/components/ReportTypeSelector';
import FileDropZone from '@/components/FileDropZone';
import UploadProgress from '@/components/UploadProgress';
import UploadHistory from '@/components/UploadHistory';
import { hashFile } from '@/lib/hashFile';
import { generateFileName } from '@/lib/fileRename';
import { createBrowserClient } from '@/lib/supabase';

export default function UploadPage() {
  // State
  const [selectedType, setSelectedType] = useState(null);
  const [file, setFile] = useState(null);
  const [sha256, setSha256] = useState(null);
  const [isHashing, setIsHashing] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [renamedFileName, setRenamedFileName] = useState(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStep, setUploadStep] = useState('');
  const [uploadResult, setUploadResult] = useState(null); // { success, message, rowCount }

  const [uploads, setUploads] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);

  // Load recent uploads on mount
  useEffect(() => {
    loadRecentUploads();
  }, []);

  const loadRecentUploads = async () => {
    try {
      setUploadsLoading(true);
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from('upload_audit_log')
        .select('*')
        .order('uploaded_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Failed to load uploads:', error);
        setUploads([]);
      } else {
        setUploads(data || []);
      }
    } catch (err) {
      console.error('Failed to load uploads:', err);
      setUploads([]);
    } finally {
      setUploadsLoading(false);
    }
  };

  // When file is selected, compute SHA-256 and check for duplicates
  const handleFileSelect = useCallback(
    async (selectedFile) => {
      setFile(selectedFile);
      setSha256(null);
      setIsDuplicate(false);
      setDuplicateInfo(null);
      setUploadResult(null);

      // Generate renamed filename
      const newName = generateFileName(selectedType);
      setRenamedFileName(newName);

      // Compute SHA-256
      setIsHashing(true);
      try {
        const hash = await hashFile(selectedFile);
        setSha256(hash);

        // Check for duplicate in audit log
        const supabase = createBrowserClient();
        const { data } = await supabase
          .from('upload_audit_log')
          .select('*')
          .eq('file_sha256', hash)
          .single();

        if (data) {
          setIsDuplicate(true);
          setDuplicateInfo(data);
        }
      } catch (err) {
        console.error('Hashing/dedup check failed:', err);
      } finally {
        setIsHashing(false);
      }
    },
    [selectedType]
  );

  const handleFileRemove = () => {
    setFile(null);
    setSha256(null);
    setIsDuplicate(false);
    setDuplicateInfo(null);
    setRenamedFileName(null);
    setUploadResult(null);
  };

  const handleTypeSelect = (type) => {
    setSelectedType(type);
    // Reset file state when changing type
    handleFileRemove();
  };

  // Upload handler
  const handleUpload = async () => {
    if (!file || !selectedType || !sha256 || isDuplicate) return;

    setIsUploading(true);
    setUploadProgress(10);
    setUploadStep('Preparing upload…');
    setUploadResult(null);

    try {
      // Build form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('reportType', selectedType);
      formData.append('sha256', sha256);
      formData.append('originalFileName', file.name);

      setUploadProgress(20);
      setUploadStep('Uploading to storage…');

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      setUploadProgress(60);
      setUploadStep('Processing data…');

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          // Duplicate detected server-side
          setIsDuplicate(true);
          setDuplicateInfo(result.duplicateInfo || null);
          setUploadResult({
            success: false,
            message: result.error || 'Duplicate file — upload blocked.',
          });
        } else {
          setUploadResult({
            success: false,
            message: result.error || 'Upload failed. Please try again.',
          });
        }
        return;
      }

      setUploadProgress(100);
      setUploadStep('Complete!');

      setUploadResult({
        success: true,
        message: `Successfully uploaded ${result.rowCount?.toLocaleString() || 0} rows as "${result.renamedFileName}".`,
        rowCount: result.rowCount,
      });

      // Refresh history
      await loadRecentUploads();

      // Reset form after success
      setTimeout(() => {
        handleFileRemove();
      }, 3000);
    } catch (err) {
      console.error('Upload error:', err);
      setUploadResult({
        success: false,
        message: 'Network error. Please check your connection and try again.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const canUpload = file && selectedType && sha256 && !isDuplicate && !isHashing && !isUploading;

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-icon">💾</div>
        <div className="page-header-text">
          <h1>Data Upload</h1>
          <p>Medallion pipeline — files are renamed, hashed, and stored in the raw layer.</p>
        </div>
      </div>

      {/* Upload Grid */}
      <div className="upload-grid">
        {/* Left: Pipeline Status */}
        <div className="card">
          <div className="card-header">
            <span className="card-header-icon">⚡</span>
            <h3>Pipeline Status</h3>
          </div>
          <div className="pipeline-status-list">
            <div className="pipeline-status-item">
              <span className="pipeline-status-label">Raw Layer</span>
              <span className="status-badge success">
                <span className="status-dot" />
                Ready
              </span>
            </div>
            <div className="pipeline-status-item">
              <span className="pipeline-status-label">Silver Layer</span>
              <span className="status-badge processing">
                <span className="status-dot" />
                Pending
              </span>
            </div>
            <div className="pipeline-status-item">
              <span className="pipeline-status-label">Gold Layer</span>
              <span className="status-badge processing">
                <span className="status-dot" />
                Pending
              </span>
            </div>
          </div>
          <div className="pipeline-stat-row">
            <span className="pipeline-stat-label">Total Uploads</span>
            <span className="pipeline-stat-value">{uploads.length}</span>
          </div>
          <div className="pipeline-stat-row">
            <span className="pipeline-stat-label">Last Activity</span>
            <span className="pipeline-stat-date">
              {uploads[0]?.uploaded_at
                ? new Date(uploads[0].uploaded_at).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—'}
            </span>
          </div>
        </div>

        {/* Right: Upload Reports */}
        <div className="card">
          <div className="card-header">
            <span className="card-header-icon">☁️</span>
            <h3>Upload Reports</h3>
          </div>

          {/* Report type selector */}
          <ReportTypeSelector
            selectedType={selectedType}
            onSelect={handleTypeSelect}
          />

          {/* File section */}
          <div style={{ marginTop: '20px' }}>
            <p className="section-label">File</p>
            <FileDropZone
              selectedType={selectedType}
              file={file}
              onFileSelect={handleFileSelect}
              onFileRemove={handleFileRemove}
              sha256={sha256}
              isHashing={isHashing}
              isDuplicate={isDuplicate}
              duplicateInfo={duplicateInfo}
              renamedFileName={renamedFileName}
            />
          </div>

          {/* Upload button */}
          <button
            className={`upload-btn ${isUploading ? 'uploading' : ''}`}
            onClick={handleUpload}
            disabled={!canUpload}
            type="button"
          >
            {isUploading ? (
              <>
                <div className="spinner" />
                Uploading…
              </>
            ) : (
              <>
                ☁️ Upload to Raw Layer
              </>
            )}
          </button>

          {/* Progress */}
          {isUploading && (
            <UploadProgress progress={uploadProgress} step={uploadStep} />
          )}

          {/* Result messages */}
          {uploadResult && uploadResult.success && (
            <div className="upload-success">
              <span className="success-icon">✅</span>
              <div className="success-text">
                <strong>Upload successful!</strong>
                {uploadResult.message}
              </div>
            </div>
          )}

          {uploadResult && !uploadResult.success && !isDuplicate && (
            <div className="duplicate-warning" style={{ background: 'var(--status-error-bg)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
              <span className="warning-icon">❌</span>
              <div className="warning-text" style={{ color: '#991B1B' }}>
                <strong>Upload failed</strong>
                {uploadResult.message}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Upload History */}
      <UploadHistory uploads={uploads} loading={uploadsLoading} />
    </>
  );
}
