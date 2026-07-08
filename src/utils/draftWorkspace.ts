import type { ImageItem } from "../data/demoImages";
import type { DraftVisit, DraftWorkspace, Visit } from "../models/blomzip";
import type { ZipImportSummary } from "./readZipImages";

const DRAFT_STORAGE_KEY = "blomzip-studio:draft-workspace:v1";

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDraftVisit(value: unknown): value is DraftVisit {
  if (!value || typeof value !== "object") {
    return false;
  }

  const draftVisit = value as DraftVisit;
  return (
    typeof draftVisit.id === "string" &&
    typeof draftVisit.label === "string" &&
    typeof draftVisit.createdAt === "string" &&
    typeof draftVisit.savedAt === "string" &&
    typeof draftVisit.visit === "object" &&
    Array.isArray(draftVisit.studioImages)
  );
}

function sanitizeWorkspace(workspace: DraftWorkspace): DraftWorkspace {
  return {
    activeDraftId: typeof workspace.activeDraftId === "string" ? workspace.activeDraftId : null,
    drafts: workspace.drafts.filter(isDraftVisit).map((draft) => cloneValue(draft)),
  };
}

export function loadDraftWorkspace(): DraftWorkspace {
  if (typeof window === "undefined") {
    return { drafts: [], activeDraftId: null };
  }

  const serializedWorkspace = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!serializedWorkspace) {
    return { drafts: [], activeDraftId: null };
  }

  try {
    const parsedWorkspace = JSON.parse(serializedWorkspace) as unknown;

    if (!parsedWorkspace || typeof parsedWorkspace !== "object") {
      return { drafts: [], activeDraftId: null };
    }

    const rawWorkspace = parsedWorkspace as Partial<DraftWorkspace>;
    return sanitizeWorkspace({
      drafts: Array.isArray(rawWorkspace.drafts) ? rawWorkspace.drafts.filter(isDraftVisit) : [],
      activeDraftId: typeof rawWorkspace.activeDraftId === "string" ? rawWorkspace.activeDraftId : null,
    });
  } catch {
    return { drafts: [], activeDraftId: null };
  }
}

export function saveDraftWorkspace(workspace: DraftWorkspace): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(sanitizeWorkspace(workspace)));
}

export function createDraftVisitFromState(options: {
  visit: Visit;
  studioImages: ImageItem[];
  label?: string;
}): DraftVisit {
  const savedAt = new Date().toISOString();

  return {
    id: options.visit.id,
    label: options.label ?? `Draft ${options.visit.date}`,
    createdAt: options.visit.date,
    savedAt,
    visit: cloneValue(options.visit),
    studioImages: cloneValue(options.studioImages),
  };
}

export function upsertDraftVisit(workspace: DraftWorkspace, draftVisit: DraftVisit): DraftWorkspace {
  const drafts = workspace.drafts.filter((draft) => draft.id !== draftVisit.id);

  return {
    activeDraftId: draftVisit.id,
    drafts: [...drafts, cloneValue(draftVisit)].sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
  };
}

export function createDraftImportSummary(draftVisit: DraftVisit): ZipImportSummary {
  const imageRecords = draftVisit.visit.imageRecords ?? [];

  return {
    fileName: `${draftVisit.label}.json`,
    status: "ready",
    imageCount: imageRecords.length,
    totalImageSize: imageRecords.reduce((total, record) => total + record.fileSize, 0),
    imageFiles: imageRecords.map((record) => record.filename),
    sidecarFound: false,
    sidecarErrors: [],
    sidecar: null,
  };
}