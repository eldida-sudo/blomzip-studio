import { useEffect, useState } from "react";
import { type Visit } from "../models/blomzip";
import { createTemporaryVisitFromZip } from "../utils/createTemporaryVisitFromZip";
import { revokeThumbnailUrls } from "../utils/createThumbnailUrls";
import { readZipImages, type ZipImportSummary } from "../utils/readZipImages";

interface ZipImportPanelProps {
  className?: string;
  onImportStateChange?: (state: { summary: ZipImportSummary | null; visit: Visit | null }) => void;
}

export function ZipImportPanel({ className, onImportStateChange }: ZipImportPanelProps) {
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
    onImportStateChange?.({ summary: result, visit });
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

      {(summary || temporaryVisit) && (
        <div className="sidebar-card import-helper-card">
          <span>Import view</span>
          <strong>{summary?.status === "ready" ? "Results live in Import Mode" : "Archive is being prepared"}</strong>
          <p className="result-count">
            The main import workspace now holds the archive summary, timeline order, previews and entry review flow.
          </p>
        </div>
      )}
    </section>
  );
}
