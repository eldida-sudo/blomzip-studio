import type { ImageRecord } from "../models/blomzip";

export function createThumbnailUrlForRecord(record: Pick<ImageRecord, "thumbnailUrl">): string | undefined {
  return record.thumbnailUrl;
}

export function revokeThumbnailUrls(records: ImageRecord[]) {
  for (const record of records) {
    if (record.thumbnailUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(record.thumbnailUrl);
    }
  }
}
