import type { ImageItem } from "../data/demoImages";

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
  importBatches?: ImportBatch[];
  status?: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  importedAt: string;
  imageCount: number;
  sourceMetadata?: Record<string, unknown>;
}

export interface DraftVisit {
  id: string;
  label: string;
  createdAt: string;
  savedAt: string;
  visit: Visit;
  studioImages: ImageItem[];
}

export interface DraftWorkspace {
  drafts: DraftVisit[];
  activeDraftId: string | null;
}

export interface ImageRecord {
  id: string;
  importBatchId?: string;
  placeId?: string;
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
  
  // Sidecar-provided metadata
  location?: Location;
  notes?: string;
  tags?: string[];
  custom?: Record<string, string | number | boolean>;
}

export interface Entry {
  id: string;
  imageRecordId: string;
  visitId: string;
  status: "new";
  notes: string;
  tags: string[];
  observations: Observation[];
  analysisSuggestions?: EntryAnalysisSuggestions;
  visualAnalysis?: VisualAnalysisResult;
  favorite?: boolean;
  hero?: boolean;
  storySelected?: boolean;
  reviewed?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Narrow set of genuine, pixel-grounded signals a vision provider can report.
// "negative-space" and "focal-structure" are reserved for future Hero analysis
// and are intentionally not consumed by Story v0.2.
export type VisualEvidenceSignalId =
  | "human-activity"
  | "spatial-overview"
  | "place-legibility"
  | "visible-change-cue"
  | "vegetation-state"
  | "negative-space"
  | "focal-structure";

export interface VisualEvidenceSignal {
  signal: VisualEvidenceSignalId;
  confidence: number;
  detail: string;
  provider: string;
  analysisVersion: number;
}

// Result of genuine, curator-triggered visual analysis of a single image.
// Kept distinct from mock Observations and from editorial EntryRecommendation evidence.
export interface VisualAnalysisResult {
  signals: VisualEvidenceSignal[];
  provider: string;
  generatedAt: string;
  analysisVersion: number;
}

export type EntrySuggestionCategory =
  | "story-candidate"
  | "hero-candidate"
  | "favorite-candidate"
  | "strong-change"
  | "overview-image"
  | "detail-image"
  | "by-place"
  | "needs-review"
  | "low-confidence"
  | "possible-duplicates";

export type EntryRecommendationKind = "story" | "hero" | "favorite";

export interface EntryRecommendationEvidence {
  signal: string;
  contribution?: number;
  detail?: string;
}

export interface EntryRecommendation {
  kind: EntryRecommendationKind;
  score: number;
  reasons: string[];
  evidence: EntryRecommendationEvidence[];
  engine: string;
  generatedAt: string;
  analysisVersion: number;
}

export interface EntryAnalysisSuggestions {
  engine: "mock-observation-engine" | "future-vision-engine";
  generatedAt: string;
  confidence: number;
  categories: EntrySuggestionCategory[];
  possibleDuplicateEntryIds?: string[];
  recommendations?: EntryRecommendation[];
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
  accepted?: boolean;
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