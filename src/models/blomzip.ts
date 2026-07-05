export interface Place {
  id: string;
  name: string;
  slug: string;
  description?: string;

  location?: Location;

  visits: Visit[];
  stories?: Story[];
}

export interface Visit {
  id: string;

  placeId: string;

  date: string;

  weather?: Weather;

  entries: Entry[];

  imageCount?: number;
  importedImageFiles?: string[];
  imageRecords?: ImageRecord[];
  status?: string;
}

export interface ImageRecord {
  id: string;
  filename: string;
  fileSize: number;
  format: string;
  sourcePath: string;
  captureDate?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  orientation?: "portrait" | "landscape" | "square";
  mimeType?: string;
  timelineIndex?: number;
  thumbnailUrl?: string;
}

export interface Entry {
  id: string;
  imageRecordId: string;
  visitId: string;
  status: "new";
  notes: string;
  tags: string[];
  observations: Observation[];
  createdAt: string;
  updatedAt: string;
}

export interface Observation {
  id: string;
  entryId: string;
  type: string;
  confidence?: number;
  source: "ai" | "user" | "mock-ai";
  value: string;
  createdAt: string;
  reviewed: boolean;
}

export interface FieldNote {
  id: string;

  text: string;

  author?: string;

  createdAt: string;
}

export interface Photo {
  id: string;

  url: string;

  caption?: string;
}

export interface Story {
  id: string;

  title: string;

  body: string;
}

export interface Weather {
  temperature?: number;

  conditions?: string;
}

export interface Location {
  latitude?: number;

  longitude?: number;
}

export type ObservationType =
  | "plant"
  | "wildlife"
  | "maintenance"
  | "change"
  | "season"
  | "general";