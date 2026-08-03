import type { Entry, ImportBatch, Location, Observation, Visit, Weather } from "../models/blomzip";

export interface PublishReadyVisitOutput {
  schema: "blomzip.publish-ready.visit";
  schemaVersion: "1.2.0";
  stage: "publish";
  exportedAt: string;
  counts: {
    totalEntries: number;
    reviewedEntries: number;
    pendingEntries: number;
    exportedEntries: number;
    storySelectedEntries: number;
  };
  visit: PublishReadyVisitMetadata;
  entries: PublishReadyEntry[];
  storyReady: {
    selectedEntries: PublishReadyEntry[];
  };
  rawVisit: Visit;
}

export interface PublishReadyVisitMetadata {
  id: string;
  placeId: string;
  date: string;
  status?: string;
  imageCount?: number;
  importedImageFiles?: string[];
  importBatches?: ImportBatch[];
  weather?: Weather;
  location?: Location;
}

export interface PublishReadyEntry {
  id: string;
  visitId: string;
  imageRecordId: string;
  review: {
    reviewed: boolean;
    status: Entry["status"];
  };
  curation: {
    favorite: boolean;
    hero: boolean;
    storySelected: boolean;
  };
  content: {
    notes: string;
    tags: string[];
    observations: Observation[];
  };
  image: {
    filename: string;
    sourcePath: string;
    placeId?: string;
    format: string;
    fileSize: number;
    timelineIndex?: number;
    captureDate?: string;
    width?: number;
    height?: number;
    aspectRatio?: number;
    orientation?: "portrait" | "landscape" | "square";
    mimeType?: string;
    thumbnailUrl?: string;
    location?: Location;
  } | null;
  createdAt: string;
  updatedAt: string;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createPublishReadyVisitOutput(
  visit: Visit,
  exportedAt: string = new Date().toISOString()
): PublishReadyVisitOutput {
  const imageRecordsById = new Map((visit.imageRecords ?? []).map((record) => [record.id, record]));
  const entries = visit.entries.map((entry): PublishReadyEntry => {
    const imageRecord = imageRecordsById.get(entry.imageRecordId);

    return {
      id: entry.id,
      visitId: entry.visitId,
      imageRecordId: entry.imageRecordId,
      review: {
        reviewed: Boolean(entry.reviewed),
        status: entry.status,
      },
      curation: {
        favorite: Boolean(entry.favorite),
        hero: Boolean(entry.hero),
        storySelected: Boolean(entry.storySelected),
      },
      content: {
        notes: entry.notes,
        tags: [...entry.tags],
        observations: cloneValue(entry.observations),
      },
      image: imageRecord
        ? {
            filename: imageRecord.filename,
            sourcePath: imageRecord.sourcePath,
            ...(imageRecord.placeId ? { placeId: imageRecord.placeId } : {}),
            format: imageRecord.format,
            fileSize: imageRecord.fileSize,
            timelineIndex: imageRecord.timelineIndex,
            captureDate: imageRecord.captureDate,
            width: imageRecord.width,
            height: imageRecord.height,
            aspectRatio: imageRecord.aspectRatio,
            orientation: imageRecord.orientation,
            mimeType: imageRecord.mimeType,
            thumbnailUrl: imageRecord.thumbnailUrl,
            location: imageRecord.location,
          }
        : null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  });
  const reviewedEntries = entries.filter((entry) => entry.review.reviewed).length;
  const totalEntries = entries.length;
  const pendingEntries = totalEntries - reviewedEntries;
  const storySelectedEntries = entries.filter((entry) => entry.curation.storySelected).length;

  return {
    schema: "blomzip.publish-ready.visit",
    schemaVersion: "1.2.0",
    stage: "publish",
    exportedAt,
    counts: {
      totalEntries,
      reviewedEntries,
      pendingEntries,
      exportedEntries: entries.length,
      storySelectedEntries,
    },
    visit: {
      id: visit.id,
      placeId: visit.placeId,
      date: visit.date,
      status: visit.status,
      imageCount: visit.imageCount,
      importedImageFiles: visit.importedImageFiles ? [...visit.importedImageFiles] : undefined,
      importBatches: visit.importBatches ? cloneValue(visit.importBatches) : undefined,
      weather: visit.weather ? cloneValue(visit.weather) : undefined,
      location: (visit as Visit & { location?: Location }).location
        ? cloneValue((visit as Visit & { location?: Location }).location)
        : undefined,
    },
    entries,
    storyReady: {
      selectedEntries: entries.filter((entry) => entry.curation.storySelected),
    },
    rawVisit: cloneValue(visit),
  };
}
