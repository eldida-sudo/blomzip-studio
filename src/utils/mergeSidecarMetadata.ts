import { type ImageRecord } from "../models/blomzip";
import { type ImageSidecarMetadata, type LocationData, type VisitMetadata } from "../models/importSidecar";

/**
 * Merges sidecar image metadata into an ImageRecord.
 * Sidecar data takes priority over auto-extracted data.
 * 
 * @param imageRecord Base image record from ZIP extraction
 * @param sidecarMetadata Optional sidecar metadata for this specific image
 * @returns Merged ImageRecord with sidecar data applied
 */
export function mergeImageSidecarMetadata(
  imageRecord: ImageRecord,
  sidecarMetadata?: ImageSidecarMetadata
): ImageRecord {
  if (!sidecarMetadata) {
    return imageRecord;
  }

  const merged = { ...imageRecord };

  // Override capture date if provided
  if (sidecarMetadata.captureDate) {
    merged.captureDate = sidecarMetadata.captureDate;
  }

  // Override dimensions if provided
  if (sidecarMetadata.dimensions) {
    merged.width = sidecarMetadata.dimensions.width;
    merged.height = sidecarMetadata.dimensions.height;
    merged.aspectRatio = sidecarMetadata.dimensions.width / sidecarMetadata.dimensions.height;
  }

  // Merge location data
  if (sidecarMetadata.location) {
    // For now, sidecar location completely replaces auto-extracted location
    // In future, could enhance with GPS coordinate enrichment
    merged.location = sidecarMetadata.location;
  }

  // Add notes if provided
  if (sidecarMetadata.notes) {
    merged.notes = sidecarMetadata.notes;
  }

  // Merge tags
  if (sidecarMetadata.tags && sidecarMetadata.tags.length > 0) {
    merged.tags = [...new Set([...(merged.tags ?? []), ...sidecarMetadata.tags])];
  }

  // Merge custom metadata
  if (sidecarMetadata.custom) {
    merged.custom = {
      ...(merged.custom ?? {}),
      ...sidecarMetadata.custom,
    };
  }

  return merged;
}

/**
 * Extends an ImageRecord with properties it may not have yet.
 * These are added from sidecar data that provides information not
 * directly extractable from the image file itself.
 */
export interface ExtendedImageRecord extends ImageRecord {
  location?: LocationData;
  notes?: string;
  tags?: string[];
  custom?: Record<string, string | number | boolean>;
}

// Type guard to check if ImageRecord has been extended
export function isExtendedImageRecord(record: ImageRecord): record is ExtendedImageRecord {
  return (
    "location" in record || "notes" in record || "tags" in record || "custom" in record
  );
}

/**
 * Merges visit-level sidecar metadata into the Visit's date and weather.
 * 
 * @param date Current visit date (can come from ZIP context)
 * @param weather Current visit weather (likely undefined)
 * @param sidecarVisitMetadata Optional visit metadata from sidecar
 * @returns Updated date and weather objects
 */
export function mergeVisitSidecarMetadata(
  date: string,
  weather: any,
  sidecarVisitMetadata?: VisitMetadata
): { date: string; weather: any; location?: LocationData } {
  let result = { date, weather };

  if (!sidecarVisitMetadata) {
    return result;
  }

  // Override date if sidecar provides one
  if (sidecarVisitMetadata.date) {
    result.date = sidecarVisitMetadata.date;
  }

  // Override or add weather data
  if (sidecarVisitMetadata.weather) {
    result.weather = {
      ...result.weather,
      ...sidecarVisitMetadata.weather,
    };
  }

  // Add location if provided
  if (sidecarVisitMetadata.location) {
    (result as any).location = sidecarVisitMetadata.location;
  }

  return result;
}

/**
 * Looks up sidecar metadata for a specific image by filename.
 * 
 * @param filename The image filename to look up
 * @param imageMetadataList List of image metadata from sidecar
 * @returns The matching ImageSidecarMetadata or undefined
 */
export function findImageMetadataInSidecar(
  filename: string,
  imageMetadataList?: ImageSidecarMetadata[]
): ImageSidecarMetadata | undefined {
  if (!imageMetadataList) {
    return undefined;
  }

  return imageMetadataList.find((meta) => meta.filename === filename);
}
