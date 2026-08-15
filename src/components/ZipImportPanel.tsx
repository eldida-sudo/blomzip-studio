import { useEffect, useMemo, useRef, useState } from "react";
import { type Visit } from "../models/blomzip";
import { importSingleZip } from "../utils/importSingleZip";
import { revokeThumbnailUrls } from "../utils/createThumbnailUrls";
import { type ZipImportSummary } from "../utils/readZipImages";

type QueueItemStatus = "waiting" | "importing" | "imported" | "failed";

interface QueueItem {
  id: string;
  fileName: string;
  queuePosition: number;
  status: QueueItemStatus;
  imageCount?: number;
  errorMessage?: string;
}

interface ZipImportPanelProps {
  className?: string;
  onImportStateChange?: (state: { summary: ZipImportSummary | null; visit: Visit | null }) => void;
}

export function ZipImportPanel({ className, onImportStateChange }: ZipImportPanelProps) {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [isQueueActive, setIsQueueActive] = useState(false);
  const allImportedImageRecordsRef = useRef<NonNullable<Visit["imageRecords"]>>([]);
  // Guards against a stale queue loop acting after a newer selection has started.
  const queueRunTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      revokeThumbnailUrls(allImportedImageRecordsRef.current);
    };
  }, []);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const inputElement = event.target;
    const fileList = inputElement.files;

    if (!fileList || fileList.length === 0) {
      return;
    }

    // Defensive dedupe: never process the same File object twice within one selection.
    const seenFiles = new Set<File>();
    const selectedFiles: File[] = [];

    for (let index = 0; index < fileList.length; index += 1) {
      const file = fileList[index];

      if (seenFiles.has(file)) {
        continue;
      }

      seenFiles.add(file);
      selectedFiles.push(file);
    }

    // Reset the input so selecting the same file(s) again later still fires a change event.
    inputElement.value = "";

    if (selectedFiles.length === 0) {
      return;
    }

    const runToken = queueRunTokenRef.current + 1;
    queueRunTokenRef.current = runToken;

    const initialQueueItems: QueueItem[] = selectedFiles.map((file, index) => ({
      id: `zip-queue-${runToken}-${index}-${file.name}`,
      fileName: file.name,
      queuePosition: index + 1,
      status: "waiting",
    }));

    setQueueItems(initialQueueItems);
    setIsQueueActive(true);

    // Process one ZIP at a time; the next file only starts once the previous
    // one has completed or failed. Never unpack/analyze ZIPs concurrently.
    for (let index = 0; index < selectedFiles.length; index += 1) {
      if (queueRunTokenRef.current !== runToken) {
        return;
      }

      const file = selectedFiles[index];
      const itemId = initialQueueItems[index].id;

      setQueueItems((currentItems) =>
        currentItems.map((item) => (item.id === itemId ? { ...item, status: "importing" } : item))
      );

      const result = await importSingleZip(file);

      if (queueRunTokenRef.current !== runToken) {
        return;
      }

      if (result.status === "success" && result.visit?.imageRecords) {
        allImportedImageRecordsRef.current = [...allImportedImageRecordsRef.current, ...result.visit.imageRecords];
      }

      setQueueItems((currentItems) =>
        currentItems.map((item) => {
          if (item.id !== itemId) {
            return item;
          }

          return result.status === "success"
            ? { ...item, status: "imported", imageCount: result.summary.imageCount }
            : { ...item, status: "failed", errorMessage: result.errorMessage ?? "Import failed." };
        })
      );

      // A failed ZIP is isolated: it never rolls back previously imported ZIPs
      // and the queue continues with the next file.
      onImportStateChange?.({
        summary: result.summary,
        visit: result.status === "success" ? result.visit : null,
      });
    }

    if (queueRunTokenRef.current === runToken) {
      setIsQueueActive(false);
    }
  }

  const overallProgressLabel = useMemo(() => {
    if (queueItems.length === 0) {
      return null;
    }

    if (isQueueActive) {
      const activeIndex = queueItems.findIndex((item) => item.status === "importing" || item.status === "waiting");
      const position = activeIndex >= 0 ? activeIndex + 1 : queueItems.length;
      return `Importing ${position} of ${queueItems.length} ZIP archives`;
    }

    const importedCount = queueItems.filter((item) => item.status === "imported").length;
    const failedCount = queueItems.filter((item) => item.status === "failed").length;
    const failedSuffix = failedCount > 0 ? ` · ${failedCount} failed` : "";

    return `${queueItems.length} ZIP archives processed · ${importedCount} imported${failedSuffix}`;
  }, [queueItems, isQueueActive]);

  function getQueueItemStatusLabel(item: QueueItem): string {
    switch (item.status) {
      case "waiting":
        return "Waiting";
      case "importing":
        return "Importing…";
      case "imported":
        return `Imported · ${item.imageCount ?? 0} photographs`;
      case "failed":
        return `Failed · ${item.errorMessage ?? "Import error"}`;
      default:
        return "";
    }
  }

  return (
    <section className={className}>
      <div className="sidebar-card">
        <div>
          <p className="eyebrow">ZIP import</p>
          <h3>Import ZIP archives</h3>
          <p className="result-count">
            Select one or more archives to read images, extract metadata and stage them for the current studio flow.
          </p>
        </div>
      </div>

      <label
        className={`sidebar-card import-card ${isQueueActive ? "import-card-disabled" : ""}`}
        htmlFor="zip-import-input"
      >
        <span>Select ZIP file(s)</span>
        <strong>{isQueueActive ? "Import in progress…" : "Choose archive(s)…"}</strong>
        <input
          id="zip-import-input"
          type="file"
          accept=".zip,application/zip"
          multiple
          disabled={isQueueActive}
          onChange={handleFileChange}
        />
      </label>

      {overallProgressLabel && (
        <p className="result-count" data-testid="zip-queue-overall-progress" aria-live="polite">
          {overallProgressLabel}
        </p>
      )}

      {queueItems.length > 0 && (
        <div className="sidebar-card zip-queue-card" data-testid="zip-import-queue">
          <span>Import queue</span>
          <ul className="zip-queue-list">
            {queueItems.map((item) => (
              <li
                key={item.id}
                className={`zip-queue-item zip-queue-item-${item.status}`}
                data-testid={`zip-queue-item-${item.fileName}`}
              >
                <span className="zip-queue-item-position">#{item.queuePosition}</span>
                <span className="zip-queue-item-name">{item.fileName}</span>
                <span className="zip-queue-item-status">{getQueueItemStatusLabel(item)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
