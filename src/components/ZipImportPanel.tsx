import { useState } from "react";
import { readZipImages, type ZipImportSummary } from "../utils/readZipImages";

interface ZipImportPanelProps {
  className?: string;
}

export function ZipImportPanel({ className }: ZipImportPanelProps) {
  const [summary, setSummary] = useState<ZipImportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const result = await readZipImages(selectedFile);

    setSummary(result);
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
    </section>
  );
}
