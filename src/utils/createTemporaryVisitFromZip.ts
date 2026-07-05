import { type Entry, type ImageRecord, type Visit } from "../models/blomzip";
import { extractImageMetadata } from "./extractImageMetadata";
import { orderImageRecordsForTimeline } from "./orderImageRecordsForTimeline";
import { type ZipImportSummary } from "./readZipImages";
import {
  findImageMetadataInSidecar,
  mergeImageSidecarMetadata,
  mergeVisitSidecarMetadata,
} from "./mergeSidecarMetadata";

function createThumbnailUrlFromImageData(data: Uint8Array, fileName: string) {
  const mimeType = fileName.toLowerCase().endsWith("png") ? "image/png" : fileName.toLowerCase().endsWith("webp") ? "image/webp" : "image/jpeg";
  const bytes = data.slice();
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

interface VisitCreationOptions {
  date?: string;
}

function createEntries(imageRecords: ImageRecord[], visitId: string): Entry[] {
  return imageRecords.map((imageRecord, index) => {
    const now = new Date().toISOString();

    return {
      id: `entry-${index}-${imageRecord.id}`,
      imageRecordId: imageRecord.id,
      visitId,
      status: "new",
      notes: "",
      tags: [],
      observations: [],
      createdAt: now,
      updatedAt: now,
    };
  });
}

function createImageRecords(summary: ZipImportSummary): ImageRecord[] {
  const imageRecords = summary.imageFiles.map((filename, index) => {
    const imageEntry = summary.imageEntries?.[index];
    const metadata = imageEntry?.data ? extractImageMetadata(imageEntry.data, filename) : {};

    let record: ImageRecord = {
      id: `image-${index}-${filename}`,
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

  const imageRecords = createImageRecords(summary);
  const visitId = `visit-${summary.fileName}-${summary.imageCount}-${Date.now()}`;

  const visit: Visit = {
    id: visitId,
    placeId: "temporary-import",
    date: visitDate,
    entries: createEntries(imageRecords, visitId),
    imageCount: summary.imageCount,
    importedImageFiles: summary.imageFiles,
    imageRecords,
    status: "Ready for AI",
    weather: visitWeather,
  };

  // Add location if available from sidecar
  if (visitLocation) {
    (visit as any).location = visitLocation;
  }

  return visit;
}
