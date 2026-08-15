import { type Entry, type ImageRecord, type Visit } from "../models/blomzip";
import { extractImageMetadata } from "./extractImageMetadata";
import { orderImageRecordsForTimeline } from "./orderImageRecordsForTimeline";
import { parseCaptureDate } from "./captureDate";
import { type ZipImportSummary } from "./readZipImages";
import {
  findImageMetadataInSidecar,
  mergeImageSidecarMetadata,
  mergeVisitSidecarMetadata,
} from "./mergeSidecarMetadata";

function createThumbnailUrlFromImageData(data: Uint8Array, fileName: string) {
  const mimeType = fileName.toLowerCase().endsWith("png") ? "image/png" : fileName.toLowerCase().endsWith("webp") ? "image/webp" : "image/jpeg";
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.slice(index, index + chunkSize));
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

interface VisitCreationOptions {
  date?: string;
  importedAt?: string;
}

function createEntries(imageRecords: ImageRecord[], visitId: string, importBatchId: string): Entry[] {
  return imageRecords.map((imageRecord, index) => {
    const now = new Date().toISOString();

    return {
      id: `entry-${importBatchId}-${index}-${imageRecord.id}`,
      imageRecordId: imageRecord.id,
      visitId,
      status: "new",
      notes: "",
      tags: [],
      observations: [],
      favorite: false,
      hero: false,
      storySelected: false,
      reviewed: false,
      createdAt: now,
      updatedAt: now,
    };
  });
}

function normalizeToDateString(value: string): string | null {
  const parsed = parseCaptureDate(value);
  if (!parsed) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function inferPrimaryDate(imageRecords: ImageRecord[]): string | null {
  const parsedDates = imageRecords
    .map((record) => record.captureDate)
    .filter((captureDate): captureDate is string => typeof captureDate === "string")
    .map((captureDate) => {
      return parseCaptureDate(captureDate)?.getTime() ?? null;
    })
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (parsedDates.length === 0) {
    return null;
  }

  return new Date(parsedDates[0]).toISOString().slice(0, 10);
}

function createImageRecords(summary: ZipImportSummary, importBatchId: string): ImageRecord[] {
  const imageRecords = summary.imageFiles.map((filename, index) => {
    const imageEntry = summary.imageEntries?.[index];
    const metadata = imageEntry?.data ? extractImageMetadata(imageEntry.data, filename) : {};

    let record: ImageRecord = {
      id: `image-${importBatchId}-${index}-${filename}`,
      importBatchId,
      filename,
      fileSize: imageEntry?.fileSize ?? 0,
      format: filename.split(".").pop()?.toLowerCase() ?? "unknown",
      sourcePath: filename,
      thumbnailUrl: imageEntry?.data ? createThumbnailUrlFromImageData(imageEntry.data, filename) : undefined,
      ...metadata,
    };

    // Merge sidecar metadata if available
    const sidecarImageMetadata = findImageMetadataInSidecar(filename, summary.sidecar?.images);
    record = mergeImageSidecarMetadata(record, sidecarImageMetadata);

    return record;
  });

  const { orderedRecords } = orderImageRecordsForTimeline(imageRecords);

  return orderedRecords.map((record, index) => ({
    ...record,
    timelineIndex: index,
  }));
}

export function createTemporaryVisitFromZip(
  summary: ZipImportSummary,
  options: VisitCreationOptions = {}
): Visit | null {
  if (summary.status !== "ready") {
    return null;
  }

  const now = new Date();
  const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const importedAt = options.importedAt ?? now.toISOString();
  const importBatchId = `batch-${summary.fileName}-${Date.now()}`;
  
  let visitDate = options.date ?? fallbackDate;
  let visitWeather: any = undefined;
  let visitLocation: any = undefined;

  // Merge visit-level sidecar metadata
  if (summary.sidecar?.visit) {
    const merged = mergeVisitSidecarMetadata(visitDate, visitWeather, summary.sidecar.visit);
    visitDate = merged.date;
    visitWeather = merged.weather;
    visitLocation = (merged as any).location;
  }

  const imageRecords = createImageRecords(summary, importBatchId);
  const inferredDate = inferPrimaryDate(imageRecords);
  const sidecarDate = summary.sidecar?.visit?.date ? normalizeToDateString(summary.sidecar.visit.date) : null;
  if (!options.date) {
    visitDate = sidecarDate ?? inferredDate ?? fallbackDate;
  }

  const visitId = `visit-${summary.fileName}-${summary.imageCount}-${Date.now()}`;

  const visit: Visit = {
    id: visitId,
    placeId: "temporary-import",
    date: visitDate,
    entries: createEntries(imageRecords, visitId, importBatchId),
    imageCount: summary.imageCount,
    importedImageFiles: summary.imageFiles,
    imageRecords,
    importBatches: [
      {
        id: importBatchId,
        fileName: summary.fileName,
        importedAt,
        imageCount: summary.imageCount,
        sourceMetadata: summary.sidecar?.settings ? { sidecarSettings: summary.sidecar.settings } : undefined,
      },
    ],
    status: "Ready for AI",
    weather: visitWeather,
  };

  // Add location if available from sidecar
  if (visitLocation) {
    (visit as any).location = visitLocation;
  }

  return visit;
}
