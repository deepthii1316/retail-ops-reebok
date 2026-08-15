'use client';

export default function UploadProgress({ progress, step }) {
  return (
    <div className="progress-container">
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="progress-text">
        <span className="progress-step">{step}</span>
        <span className="progress-pct">{progress}%</span>
      </div>
    </div>
  );
}
