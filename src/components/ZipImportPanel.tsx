import { useEffect, useState } from "react";
import { type Visit } from "../models/blomzip";
import { createTemporaryVisitFromZip } from "../utils/createTemporaryVisitFromZip";
import { revokeThumbnailUrls } from "../utils/createThumbnailUrls";
import { readZipImages, type ZipImportSummary } from "../utils/readZipImages";

interface ZipImportPanelProps {
  className?: string;
}

export function ZipImportPanel({ className }: ZipImportPanelProps) {
  const [summary, setSummary] = useState<ZipImportSummary | null>(null);
  const [temporaryVisit, setTemporaryVisit] = useState<Visit | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (temporaryVisit?.imageRecords) {
        revokeThumbnailUrls(temporaryVisit.imageRecords);
      }
    };
  }, [temporaryVisit]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const result = await readZipImages(selectedFile);
    const visit = createTemporaryVisitFromZip(result);

    setSummary(result);
    setTemporaryVisit(visit);
    setIsLoading(false);

    if (result.status === "invalid") {
      setErrorMessage(result.errorMessage ?? "The selected file could not be read as a ZIP archive.");
    }
  }

  return (
    <section className={className}>
      <div className="sidebar-card">
        <div>
          <p className="eyebrow">ZIP import</p>
          <h3>Import a ZIP archive</h3>
          <p className="result-count">
            Read an archive in the browser and inspect the image files without changing the current studio flow.
          </p>
        </div>
      </div>

      <label className="sidebar-card import-card" htmlFor="zip-import-input">
        <span>Select ZIP file</span>
        <strong>Choose archive…</strong>
        <input
          id="zip-import-input"
          type="file"
          accept=".zip,application/zip"
          onChange={handleFileChange}
        />
      </label>

      {isLoading && <p className="result-count">Reading archive…</p>}

      {errorMessage && <p className="result-count">{errorMessage}</p>}

      {summary && (
        <div className="sidebar-card import-summary">
          <div className="import-summary-header">
            <span>Archive</span>
            <strong>{summary.fileName}</strong>
          </div>

          <div className="import-summary-grid">
            <div>
              <span>Image files</span>
              <strong>{summary.imageCount}</strong>
            </div>
            <div>
              <span>Total size</span>
              <strong>{summary.totalImageSize} bytes</strong>
            </div>
          </div>

          {summary.status === "ready" && summary.imageCount === 0 && (
            <p className="result-count">No supported image files were found in this archive.</p>
          )}

          {summary.status === "empty" && (
            <p className="result-count">This archive is empty.</p>
          )}

          {summary.status === "invalid" && (
            <p className="result-count">The selected file is not a valid ZIP archive.</p>
          )}

          {summary.imageFiles.length > 0 && (
            <ul className="import-file-list">
              {summary.imageFiles.map((fileName) => (
                <li key={fileName}>{fileName}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {temporaryVisit && (
        <div className="sidebar-card import-summary">
          <div className="import-summary-header">
            <span>Visit</span>
            <strong>{temporaryVisit.date}</strong>
          </div>

          <div className="import-summary-grid">
            <div>
              <span>Images</span>
              <strong>{temporaryVisit.imageCount ?? 0}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{temporaryVisit.status ?? "Pending"}</strong>
            </div>
          </div>

          <div className="import-summary-grid">
            <div>
              <span>Image records</span>
              <strong>{temporaryVisit.imageRecords?.length ?? 0}</strong>
            </div>
            <div>
              <span>Entries</span>
              <strong>{temporaryVisit.entries?.length ?? 0} ready for review</strong>
            </div>
          </div>

          <div className="import-summary-grid">
            <div>
              <span>Formats</span>
              <strong>{Array.from(new Set((temporaryVisit.imageRecords ?? []).map((record) => record.format))).join(", ") || "—"}</strong>
            </div>
          </div>

          <div className="import-summary-grid">
            <div>
              <span>Total size</span>
              <strong>{(temporaryVisit.imageRecords ?? []).reduce((total, record) => total + record.fileSize, 0)} bytes</strong>
            </div>
          </div>

          {temporaryVisit.imageRecords && temporaryVisit.imageRecords.length > 0 && (
            <div className="timeline-summary">
              <div>
                <span>First</span>
                <strong>{temporaryVisit.imageRecords[0]?.filename}</strong>
              </div>
              <div>
                <span>Last</span>
                <strong>{temporaryVisit.imageRecords[temporaryVisit.imageRecords.length - 1]?.filename}</strong>
              </div>
              <div>
                <span>Ordered</span>
                <strong>{temporaryVisit.imageRecords.length}</strong>
              </div>
              <div>
                <span>Using</span>
                <strong>{temporaryVisit.imageRecords.some((record) => record.captureDate) ? "capture dates" : "filename fallback"}</strong>
              </div>
            </div>
          )}

          <p className="result-count">{(temporaryVisit.imageRecords ?? []).slice(0, 4).map((record) => record.filename).join(", ") || "No image records yet."}</p>

          {temporaryVisit.imageRecords && temporaryVisit.imageRecords.length > 0 && (
            <div className="preview-gallery">
              {temporaryVisit.imageRecords.map((record) => (
                <div key={record.id} className="preview-card">
                  <div className="preview-thumb">
                    {record.thumbnailUrl ? (
                      <img src={record.thumbnailUrl} alt={record.filename} />
                    ) : (
                      <span>No preview</span>
                    )}
                  </div>
                  <div className="preview-meta">
                    <strong>{record.filename}</strong>
                    <span>#{record.timelineIndex ?? 0}</span>
                    <span>
                      {record.width && record.height ? `${record.width} × ${record.height}` : "Dimensions unavailable"}
                      {record.orientation ? ` • ${record.orientation}` : ""}
                    </span>
                    <span className="preview-entry-badge">
                      Entry #{temporaryVisit.entries.findIndex((entry) => entry.imageRecordId === record.id)} • New
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {temporaryVisit.imageRecords && temporaryVisit.imageRecords.length > 0 && (
            <details className="metadata-details">
              <summary>Metadata</summary>
              <ul className="metadata-details-list">
                {temporaryVisit.imageRecords.map((record) => (
                  <li key={record.id}>
                    <strong>{record.filename}</strong>
                    <span>
                      {record.width && record.height ? `${record.width} × ${record.height}` : "Dimensions unavailable"}
                      {record.orientation ? ` • ${record.orientation}` : ""}
                      {record.mimeType ? ` • ${record.mimeType}` : ""}
                      {record.captureDate ? ` • ${record.captureDate}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="result-count">This visit exists in memory and is ready for future observations.</p>
        </div>
      )}
    </section>
  );
}
