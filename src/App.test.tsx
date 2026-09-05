/**
 * @vitest-environment jsdom
 */

import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { getGalleryCardDisplayTitle, resolveGalleryThumbnailSrc } from "./App";
import { initialImages } from "./data/demoImages";
import type { Visit } from "./models/blomzip";
import { createArchiveStateSnapshot, loadArchiveState, saveArchiveState } from "./utils/archivePersistence";
import { persistArchiveThumbnailBinaries } from "./utils/archiveThumbnailStore";
import { createPublishReadyVisitOutput } from "./utils/publishReadyOutput";
import type { ZipImportSummary } from "./utils/readZipImages";

let mockImportState: { summary: ZipImportSummary | null; visit: Visit | null } | null = null;
let hasEmittedImportState = false;
let capturedImportStateChange: ((state: { summary: ZipImportSummary | null; visit: Visit | null }) => Promise<unknown> | unknown) | null = null;

function createInMemoryIndexedDb() {
  const storeNames = new Set<string>();
  const stores = new Map<string, Map<string, unknown>>();

  const ensureStore = (storeName: string) => {
    if (!storeNames.has(storeName)) {
      storeNames.add(storeName);
      stores.set(storeName, new Map());
    }
  };

  const database = {
    objectStoreNames: {
      contains: (storeName: string) => storeNames.has(storeName),
    },
    createObjectStore: (storeName: string) => {
      ensureStore(storeName);
      return {} as IDBObjectStore;
    },
    transaction: (storeName: string) => {
      ensureStore(storeName);

      const transaction = {
        oncomplete: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onabort: null as ((event: Event) => void) | null,
        objectStore: (targetStoreName: string) => {
          ensureStore(targetStoreName);
          const targetStore = stores.get(targetStoreName) as Map<string, unknown>;

          return {
            get: (key: string) => {
              const request = {
                result: targetStore.get(key),
                onsuccess: null as ((event: Event) => void) | null,
                onerror: null as ((event: Event) => void) | null,
              };

              queueMicrotask(() => {
                request.onsuccess?.(new Event("success"));
              });

              return request;
            },
            put: (value: { key?: string; imageRecordId?: string }) => {
              const key = value.key ?? value.imageRecordId;

              if (key) {
                targetStore.set(key, value);
              }

              const request = {
                onsuccess: null as ((event: Event) => void) | null,
                onerror: null as ((event: Event) => void) | null,
              };

              queueMicrotask(() => {
                request.onsuccess?.(new Event("success"));
                transaction.oncomplete?.(new Event("complete"));
              });

              return request;
            },
          };
        },
      };

      return transaction;
    },
    close: () => undefined,
  };

  return {
    open: (_name: string, _version?: number) => {
      const request = {
        result: undefined as unknown,
        onerror: null as ((event: Event) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
        onupgradeneeded: null as ((event: Event) => void) | null,
      };

      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.(new Event("upgradeneeded"));
        request.onsuccess?.(new Event("success"));
      });

      return request;
    },
  };
}

const importedArchiveState: { summary: ZipImportSummary; visit: Visit } = {
  summary: {
    fileName: "draft.zip",
    status: "ready",
    imageCount: 2,
    totalImageSize: 24,
    imageFiles: ["courtyard-01.jpg", "courtyard-02.jpg"],
    sidecar: null,
    sidecarFound: false,
    sidecarErrors: [],
  },
  visit: {
    id: "visit-1",
    placeId: "place-1",
    date: "2026-07-08",
    imageCount: 2,
    importBatches: [
      {
        id: "batch-1",
        fileName: "draft.zip",
        importedAt: "2026-07-08T00:00:00.000Z",
        imageCount: 2,
      },
    ],
    imageRecords: [
      {
        id: "image-1",
        importBatchId: "batch-1",
        filename: "courtyard-01.jpg",
        fileSize: 12,
        format: "jpeg",
        sourcePath: "courtyard-01.jpg",
        timelineIndex: 0,
        thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
      },
      {
        id: "image-2",
        importBatchId: "batch-1",
        filename: "courtyard-02.jpg",
        fileSize: 12,
        format: "jpeg",
        sourcePath: "courtyard-02.jpg",
        timelineIndex: 1,
        thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
      },
    ],
    entries: [
      {
        id: "entry-1",
        imageRecordId: "image-1",
        visitId: "visit-1",
        status: "new",
        notes: "",
        tags: [],
        observations: [],
        analysisSuggestions: {
          engine: "mock-observation-engine",
          generatedAt: "2026-07-08T00:00:00.000Z",
          confidence: 0.61,
          categories: ["needs-review", "low-confidence", "by-place"],
        },
        reviewed: false,
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
      {
        id: "entry-2",
        imageRecordId: "image-2",
        visitId: "visit-1",
        status: "new",
        notes: "",
        tags: [],
        observations: [],
        analysisSuggestions: {
          engine: "mock-observation-engine",
          generatedAt: "2026-07-08T00:00:00.000Z",
          confidence: 0.91,
          categories: ["story-candidate", "hero-candidate", "favorite-candidate", "strong-change"],
        },
        reviewed: false,
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    ],
    status: "Ready for AI",
  },
};

function buildLargeVisionGroupState(totalImages: number): { summary: ZipImportSummary; visit: Visit } {
  const expandedState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };

  expandedState.summary.imageCount = totalImages;
  expandedState.summary.totalImageSize = totalImages * 12;
  expandedState.summary.imageFiles = Array.from({ length: totalImages }, (_, index) => `courtyard-${String(index + 1).padStart(2, "0")}.jpg`);

  const baseTime = Date.parse("2026-07-08T08:00:00.000Z");
  expandedState.visit.imageCount = totalImages;
  expandedState.visit.imageRecords = Array.from({ length: totalImages }, (_, index) => ({
    id: `image-${index + 1}`,
    importBatchId: "batch-1",
    filename: `courtyard-${String(index + 1).padStart(2, "0")}.jpg`,
    fileSize: 12,
    format: "jpeg",
    sourcePath: `courtyard/courtyard-${String(index + 1).padStart(2, "0")}.jpg`,
    width: 1600,
    height: 1200,
    orientation: "landscape" as const,
    aspectRatio: 1.3333,
    captureDate: new Date(baseTime + index * 60_000).toISOString(),
    timelineIndex: index,
    thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
  }));

  expandedState.visit.entries = Array.from({ length: totalImages }, (_, index) => ({
    id: `entry-${index + 1}`,
    imageRecordId: `image-${index + 1}`,
    visitId: "visit-1",
    status: "new" as const,
    notes: "",
    tags: [],
    observations: [],
    analysisSuggestions: {
      engine: "mock-observation-engine" as const,
      generatedAt: "2026-07-08T00:00:00.000Z",
      confidence: 0.8,
      categories: ["by-place", "needs-review"],
    },
    reviewed: false,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  }));

  return expandedState;
}

vi.mock("./components/ZipImportPanel", () => {
  function MockZipImportPanel({
    onImportStateChange,
  }: {
    onImportStateChange?: (state: { summary: ZipImportSummary | null; visit: Visit | null }) => Promise<unknown> | unknown;
  }) {
    const onImportStateChangeRef = useRef(onImportStateChange);

    onImportStateChangeRef.current = onImportStateChange;
    capturedImportStateChange = onImportStateChange ?? null;

    useEffect(() => {
      if (hasEmittedImportState) {
        return;
      }

      hasEmittedImportState = true;
      onImportStateChangeRef.current?.(mockImportState ?? importedArchiveState);
      // The real panel only reports a completed import once per file selection.
      // Keep the mock equally stable to avoid re-emitting on every App rerender.
    }, []);

    return <section data-testid="zip-import-panel" />;
  }

  return { ZipImportPanel: MockZipImportPanel };
});

describe("App", () => {
  let container: HTMLDivElement;
  let root: Root;
  let createObjectUrlSpy: ReturnType<typeof vi.fn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockImportState = JSON.parse(JSON.stringify(importedArchiveState));
    hasEmittedImportState = false;
    capturedImportStateChange = null;
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    createObjectUrlSpy = vi.fn(() => "blob:mock-url");
    revokeObjectUrlSpy = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrlSpy,
      revokeObjectURL: revokeObjectUrlSpy,
    } as unknown as typeof URL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => initialImages,
      })) as unknown as typeof fetch
    );
  });

  async function waitForArchiveHydration() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const previewButtons = container.querySelectorAll(".preview-card-button");
      const archiveReadyText = container.textContent?.includes("2 photographs across 1 import batches") ||
        container.textContent?.includes("Review AI suggestions");

      if (previewButtons.length > 0 && archiveReadyText) {
        return;
      }

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  async function waitForReviewView() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (container.textContent?.includes("Entry 1 of 2") || container.textContent?.includes("Back to archive")) {
        return;
      }

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  async function openFirstPreviewCardForRestoredArchive() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const currentPreviewButton = container.querySelectorAll(".preview-card-button")[0] as HTMLButtonElement | undefined;

      if (currentPreviewButton) {
        await act(async () => {
          currentPreviewButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      }

      await waitForReviewView();

      if (container.textContent?.includes("Entry 1 of 2") || container.textContent?.includes("Back to archive")) {
        return;
      }

      const needsConfirmationButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Needs confirmation")
      );

      if (needsConfirmationButton) {
        await act(async () => {
          needsConfirmationButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      }

      await waitForReviewView();

      if (container.textContent?.includes("Entry 1 of 2") || container.textContent?.includes("Back to archive")) {
        return;
      }
    }
  }

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders imported data-url thumbnails and imported filenames in gallery cards", () => {
    act(() => {
      root.render(<App />);
    });

    const galleryImages = Array.from(container.querySelectorAll(".gallery-card-thumb img"));
    expect(galleryImages).toHaveLength(2);
    expect((galleryImages[0] as HTMLImageElement).src).toContain("data:image/gif;base64,");
    expect(container.textContent).toContain("courtyard-01.jpg");
    expect(container.textContent).not.toContain("R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=");
  });

  it("uses the synchronously updated archive for an immediate duplicate import after curation", async () => {
    const firstImport = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    firstImport.visit.imageRecords![0].contentHash = "sha256:shared";
    mockImportState = firstImport;

    act(() => {
      root.render(<App />);
    });
    await waitForArchiveHydration();
    await openFirstPreviewCardForRestoredArchive();

    const favoriteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Mark as favorite"
    );
    expect(favoriteButton).toBeTruthy();
    act(() => {
      favoriteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const duplicateVisit: Visit = {
      ...firstImport.visit,
      id: "visit-duplicate",
      entries: [{
        ...firstImport.visit.entries[0],
        id: "entry-duplicate",
        imageRecordId: "image-duplicate",
        favorite: false,
      }],
      imageRecords: [{
        ...firstImport.visit.imageRecords![0],
        id: "image-duplicate",
        importBatchId: "batch-duplicate",
        filename: "duplicate.jpg",
        sourcePath: "other/duplicate.jpg",
        contentHash: "sha256:shared",
      }],
      importBatches: [{
        id: "batch-duplicate",
        fileName: "duplicate.zip",
        importedAt: "2026-07-09T00:00:00.000Z",
        imageCount: 1,
        rawImageCount: 1,
        importedImageCount: 1,
        duplicateSkippedCount: 0,
      }],
    };

    let outcome: unknown;
    await act(async () => {
      outcome = await capturedImportStateChange?.({
        summary: { ...firstImport.summary, fileName: "duplicate.zip", imageCount: 1, imageFiles: ["duplicate.jpg"] },
        visit: duplicateVisit,
      });
    });

    expect(outcome).toMatchObject({
      rawImageCount: 1,
      importedImageCount: 0,
      duplicateSkippedCount: 1,
      totalPhotographs: 2,
      totalBatches: 2,
    });
    expect(container.textContent).toContain("Favorite selected");
  });

  it("displays parsed capture dates and semantic undated labels alongside assigned places", async () => {
    const datedState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    const imageRecords = datedState.visit.imageRecords ?? [];

    imageRecords[0] = {
      ...imageRecords[0],
      captureDate: "2024:05:06 12:34:56",
      placeId: "rock-garden",
    };
    imageRecords[1] = {
      ...imageRecords[1],
      placeId: "house-wall",
    };
    mockImportState = datedState;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const cards = Array.from(container.querySelectorAll(".gallery-card"));
    const exifDateCard = cards.find((card) => card.textContent?.includes("courtyard-01.jpg"));
    const undatedCard = cards.find((card) => card.textContent?.includes("courtyard-02.jpg"));

    expect(exifDateCard?.textContent).toContain(new Date(2024, 4, 6, 12, 34, 56).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }));
    expect(exifDateCard?.textContent).toContain("The Rock Garden");
    expect(undatedCard?.textContent).toContain("Undated");
    expect(undatedCard?.textContent).toContain("The Bicycle Trellis Bed");
  });

  it("separates workflow, curator selections, and a compact AI recommendation summary in gallery cards", async () => {
    const hierarchyState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    hierarchyState.visit.entries[0] = {
      ...hierarchyState.visit.entries[0],
      favorite: true,
      hero: true,
      storySelected: true,
      reviewed: false,
      analysisSuggestions: {
        engine: "mock-observation-engine",
        generatedAt: "2026-07-08T00:00:00.000Z",
        confidence: 0.91,
        categories: ["story-candidate", "hero-candidate", "favorite-candidate", "strong-change"],
      },
    };
    hierarchyState.visit.entries[1] = {
      ...hierarchyState.visit.entries[1],
      reviewed: true,
    };
    mockImportState = hierarchyState;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const firstCard = Array.from(container.querySelectorAll(".gallery-card")).find((card) => card.textContent?.includes("courtyard-01.jpg"));
    const pendingWorkflow = firstCard?.querySelector('[data-testid="gallery-workflow-entry-1"]');
    const curation = firstCard?.querySelector('[data-testid="gallery-curation-entry-1"]');
    const reviewedWorkflow = container.querySelector('[data-testid="gallery-workflow-entry-2"]');

    expect(pendingWorkflow?.textContent).toBe("Pending");
    expect(pendingWorkflow?.className).toContain("gallery-card-workflow");
    expect(pendingWorkflow?.className).toContain("pending");
    expect(reviewedWorkflow?.textContent).toBe("Reviewed");
    expect(reviewedWorkflow?.className).toContain("reviewed");
    expect(curation?.textContent).toContain("Favorite");
    expect(curation?.textContent).toContain("Hero");
    expect(curation?.textContent).toContain("Story");
    expect(firstCard?.querySelector('[data-testid="gallery-ai-recommendation-entry-1"]')).toBeNull();

    act(() => {
      firstCard?.querySelector(".preview-card-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 1 of 2");
  });

  it("runs Story v0.2 analysis on the current archive and reports persisted recommendation counts", async () => {
    const storyAnalysisState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    const imageRecords = storyAnalysisState.visit.imageRecords ?? [];
    imageRecords[0] = {
      ...imageRecords[0],
      placeId: "rock-garden",
      captureDate: "2026-01-01T10:00:00.000Z",
    };
    imageRecords[1] = {
      ...imageRecords[1],
      placeId: "rock-garden",
      captureDate: "2026-02-01T10:00:00.000Z",
    };
    mockImportState = storyAnalysisState;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const storySummary = container.querySelector('[data-testid="story-analysis-summary"]');
    expect(storySummary?.textContent).toContain("Image Analysis");
    expect(storySummary?.textContent).toContain("2 analyzed images");
    expect(storySummary?.textContent).toContain("2 Story recommendations");

    act(() => {
      container.querySelector('[data-testid="run-story-analysis"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(storySummary?.textContent).toContain("2 Story recommendations");
    expect(container.querySelector('[data-testid="run-story-analysis"]')?.textContent).toBe("Update Story recommendations");
    expect((storyAnalysisState.visit.entries[0]?.analysisSuggestions?.recommendations ?? [])).toHaveLength(0);
    expect(container.querySelector('[data-testid="gallery-ai-recommendation-entry-1"]')?.textContent).toContain("AI · Story");
  });

  it("suppresses stale legacy Story display when v0.2 recommendations are authoritative", async () => {
    const v02State = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    v02State.visit.entries[0] = {
      ...v02State.visit.entries[0],
      analysisSuggestions: {
        ...v02State.visit.entries[0]?.analysisSuggestions!,
        categories: ["story-candidate"],
        recommendations: [],
      },
    };
    mockImportState = v02State;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const firstRecommendation = container.querySelector('[data-testid="gallery-ai-recommendation-entry-1"]');

    expect(firstRecommendation).toBeNull();
  });

  it("falls back to imageRecord thumbnailUrl when gallery image src is empty", () => {
    const image = {
      ...initialImages[0],
      src: "",
    };
    const imageRecord = importedArchiveState.visit.imageRecords?.[0];

    if (!imageRecord) {
      throw new Error("Expected imported image record to be present");
    }

    expect(resolveGalleryThumbnailSrc(image, imageRecord)).toBe(imageRecord.thumbnailUrl);
    expect(getGalleryCardDisplayTitle(image, imageRecord)).toBe(imageRecord.filename);
  });

  it("generates a lightweight thumbnail placeholder when persisted thumbnail data is missing", () => {
    const image = {
      ...initialImages[0],
      src: "",
    };

    const generatedThumbnail = resolveGalleryThumbnailSrc(image, {
      filename: "restored-import.jpg",
    });

    expect(generatedThumbnail).toContain("data:image/svg+xml");
    expect(generatedThumbnail).toContain("restored-import.jpg");
  });

  it("renders fallback thumbnails after loading a legacy archive snapshot with oversized thumbnail payloads", async () => {
    mockImportState = { summary: null, visit: null };

    const largeThumbnail = `data:image/jpeg;base64,${"A".repeat(150_000)}`;
    const legacyVisit: Visit = {
      id: "visit-legacy-app",
      placeId: "place-legacy",
      date: "2026-06-20",
      imageCount: 1,
      entries: [
        {
          id: "entry-legacy-app-1",
          imageRecordId: "image-legacy-app-1",
          visitId: "visit-legacy-app",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          reviewed: false,
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      imageRecords: [
        {
          id: "image-legacy-app-1",
          importBatchId: "batch-legacy-app",
          filename: "legacy-import-01.jpg",
          fileSize: 3210,
          format: "jpeg",
          sourcePath: "legacy/legacy-import-01.jpg",
          timelineIndex: 0,
          thumbnailUrl: largeThumbnail,
        },
      ],
      importBatches: [
        {
          id: "batch-legacy-app",
          fileName: "legacy-app.zip",
          importedAt: "2026-06-20T00:00:00.000Z",
          imageCount: 1,
        },
      ],
      status: "Review in progress",
    };

    window.localStorage.setItem(
      "blomzip-studio:archive-state:v1",
      JSON.stringify({
        savedAt: "2026-06-20T00:00:00.000Z",
        importVisit: legacyVisit,
        draftWorkspace: {
          drafts: [],
          activeDraftId: null,
        },
      })
    );

    act(() => {
      root.render(<App />);
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (container.textContent?.includes("legacy-import-01.jpg")) {
        break;
      }

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    const renderedThumb = container.querySelector(".gallery-card-thumb img") as HTMLImageElement | null;
    expect(renderedThumb).toBeTruthy();
    expect(renderedThumb?.src).toContain("data:image/svg+xml");
    expect(renderedThumb?.src).not.toContain("data:image/jpeg;base64,");
  });

  it("opens EntryReview at the clicked preview thumbnail", () => {
    act(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Current archive");
    expect(container.textContent).toContain("Next useful action");
    expect(container.textContent).toContain("Total photographs");
    expect(container.textContent).toContain("courtyard-01.jpg");
    expect(container.textContent).toContain("courtyard-02.jpg");
    expect(container.textContent).toContain("Capture range");
    expect(container.textContent).toContain("draft.zip imported");
    expect(container.textContent).toContain("2 supported · 2 new photographs added");
    expect(container.textContent).not.toContain("Stockrosor");
    expect(container.textContent).not.toContain("Rabatt vid husvägg");
    expect(container.querySelector("textarea")).toBeNull();

    const previewButtons = Array.from(container.querySelectorAll(".preview-card-button"));
    expect(previewButtons).toHaveLength(2);

    act(() => {
      previewButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");
    expect(container.textContent).toContain("Back to archive");
    expect(container.textContent).toContain("Review progress");
  });

  it("assigns an individual canonical place from Entry Review, persists it, and never marks the entry reviewed", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const previewButtons = Array.from(container.querySelectorAll(".preview-card-button"));
    act(() => {
      previewButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 1 of 2");
    expect(container.textContent).toContain("courtyard-01.jpg");

    const canonicalPlaceSelect = container.querySelector('[data-testid="canonical-place-select"]') as HTMLSelectElement | null;
    expect(canonicalPlaceSelect).toBeTruthy();
    expect(canonicalPlaceSelect?.value).toBe("");

    act(() => {
      if (canonicalPlaceSelect) canonicalPlaceSelect.value = "rock-garden";
      canonicalPlaceSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Pending review");

    const backButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Back to archive");
    act(() => {
      backButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const persistedSnapshot = await loadArchiveState();
    const persistedVisit = persistedSnapshot?.importVisit;
    expect(persistedVisit).toBeTruthy();

    const image1 = persistedVisit?.imageRecords?.find((record) => record.id === "image-1");
    const image2 = persistedVisit?.imageRecords?.find((record) => record.id === "image-2");
    expect(image1?.placeId).toBe("rock-garden");
    expect(image2?.placeId).toBeUndefined();

    const entry1 = persistedVisit?.entries.find((entry) => entry.imageRecordId === "image-1");
    expect(entry1?.reviewed).toBeFalsy();
    expect(entry1?.favorite).toBeFalsy();
    expect(entry1?.hero).toBeFalsy();
    expect(entry1?.storySelected).toBeFalsy();
  });

  it("excludes an individually assigned photograph from later Place Discovery runs, and clearing it restores eligibility", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    expect(container.textContent).toContain("1 candidate place groups");
    expect(container.querySelector('[data-testid="vision-group-card-vision-place-1"]')).toBeTruthy();

    const previewButtons = Array.from(container.querySelectorAll(".preview-card-button"));
    act(() => {
      previewButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const canonicalPlaceSelect = container.querySelector('[data-testid="canonical-place-select"]') as HTMLSelectElement | null;

    act(() => {
      if (canonicalPlaceSelect) canonicalPlaceSelect.value = "rock-garden";
      canonicalPlaceSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const backButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Back to archive");
    act(() => {
      backButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Only one unassigned photograph remains, so the cluster no longer meets the >= 2 minimum.
    expect(container.textContent).toContain("0 candidate place groups");
    expect(container.querySelector('[data-testid="vision-group-card-vision-place-1"]')).toBeNull();

    const previewButtonsAfterAssignment = Array.from(container.querySelectorAll(".preview-card-button"));
    act(() => {
      previewButtonsAfterAssignment[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const canonicalPlaceSelectAfter = container.querySelector('[data-testid="canonical-place-select"]') as HTMLSelectElement | null;
    expect(canonicalPlaceSelectAfter?.value).toBe("rock-garden");

    act(() => {
      if (canonicalPlaceSelectAfter) canonicalPlaceSelectAfter.value = "";
      canonicalPlaceSelectAfter?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const backButtonAgain = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Back to archive");
    act(() => {
      backButtonAgain?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("1 candidate place groups");
    expect(container.querySelector('[data-testid="vision-group-card-vision-place-1"]')).toBeTruthy();
  });

  it.each([
    "parking-trellis",
    "miriams-bed",
    "compost-area",
    "garden-arch",
    "under-maple",
    "parking-peninsula",
  ])("assigns the newly added canonical place %s from Entry Review and persists it across reload", async (newPlaceId) => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const previewButtons = Array.from(container.querySelectorAll(".preview-card-button"));
    act(() => {
      previewButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const canonicalPlaceSelect = container.querySelector('[data-testid="canonical-place-select"]') as HTMLSelectElement | null;
    expect(canonicalPlaceSelect).toBeTruthy();

    act(() => {
      if (canonicalPlaceSelect) canonicalPlaceSelect.value = newPlaceId;
      canonicalPlaceSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    mockImportState = { summary: null, visit: null };
    hasEmittedImportState = false;

    act(() => {
      root.unmount();
    });

    root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    await waitForArchiveHydration();

    const persistedSnapshot = await loadArchiveState();
    const image1 = persistedSnapshot?.importVisit?.imageRecords?.find((record) => record.id === "image-1");
    expect(image1?.placeId).toBe(newPlaceId);
  });

  it("does not lose a just-assigned canonical place when reload interrupts persistence before the IndexedDB write settles", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const previewButtons = Array.from(container.querySelectorAll(".preview-card-button"));
    act(() => {
      previewButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const canonicalPlaceSelect = container.querySelector('[data-testid="canonical-place-select"]') as HTMLSelectElement | null;

    act(() => {
      if (canonicalPlaceSelect) canonicalPlaceSelect.value = "under-maple";
      canonicalPlaceSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Give the persistence effect only a single microtask tick, not the full
    // IndexedDB round trip, before simulating an interrupting reload.
    await act(async () => {
      await Promise.resolve();
    });

    mockImportState = { summary: null, visit: null };
    hasEmittedImportState = false;

    act(() => {
      root.unmount();
    });

    root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    await waitForArchiveHydration();

    const persistedSnapshot = await loadArchiveState();
    const image1 = persistedSnapshot?.importVisit?.imageRecords?.find((record) => record.id === "image-1");
    expect(image1?.placeId).toBe("under-maple");
  });

  it("clearing a canonical place removes placeId and persists the removal across reload", async () => {
    const assignedState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    assignedState.visit.imageRecords![0].placeId = "under-maple";
    mockImportState = assignedState;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const previewButtons = Array.from(container.querySelectorAll(".preview-card-button"));
    act(() => {
      previewButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const canonicalPlaceSelect = container.querySelector('[data-testid="canonical-place-select"]') as HTMLSelectElement | null;
    expect(canonicalPlaceSelect?.value).toBe("under-maple");

    act(() => {
      if (canonicalPlaceSelect) canonicalPlaceSelect.value = "";
      canonicalPlaceSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    mockImportState = { summary: null, visit: null };
    hasEmittedImportState = false;

    act(() => {
      root.unmount();
    });

    root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    await waitForArchiveHydration();

    const persistedSnapshot = await loadArchiveState();
    const image1 = persistedSnapshot?.importVisit?.imageRecords?.find((record) => record.id === "image-1");
    expect(image1?.placeId).toBeUndefined();
  });

  it("never auto-reassigns photographs that still carry the legacy Parking Edge place id", async () => {
    const parkingState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    const imageRecords = parkingState.visit.imageRecords ?? [];
    imageRecords[0] = { ...imageRecords[0], placeId: "parking" };
    mockImportState = parkingState;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const persistedSnapshot = await loadArchiveState();
    const image1 = persistedSnapshot?.importVisit?.imageRecords?.find((record) => record.id === "image-1");
    expect(image1?.placeId).toBe("parking");
    expect(container.textContent).toContain("Parking Edge — needs reassignment");
  });

  it("filters the archive by Living Map place and restores all places", async () => {
    const assignedState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    assignedState.visit.imageRecords![0].placeId = "house-wall";
    assignedState.visit.imageRecords![1].placeId = "seating-area";
    mockImportState = assignedState;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const getFilenames = () => Array.from(container.querySelectorAll(".gallery-card")).map((card) => card.textContent ?? "");
    expect(container.querySelector("[data-testid='living-map-place-all']")?.className).toContain("is-active");
    expect(getFilenames()).toHaveLength(2);

    act(() => {
      (container.querySelector("[data-testid='living-map-hotspot-house-wall']") as SVGCircleElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(getFilenames()).toHaveLength(1);
    expect(getFilenames()[0]).toContain("courtyard-01.jpg");
    expect(container.querySelector("[data-testid='living-map-place-house-wall']")?.className).toContain("is-active");

    act(() => {
      (container.querySelector("[data-testid='living-map-place-seating-area']") as HTMLButtonElement).click();
    });
    expect(getFilenames()).toHaveLength(1);
    expect(getFilenames()[0]).toContain("courtyard-02.jpg");

    act(() => {
      (container.querySelector("[data-testid='living-map-place-all']") as HTMLButtonElement).click();
    });
    expect(getFilenames()).toHaveLength(2);
  });

  it("shows finalize readiness after all entries are reviewed and allows finalizing from gallery", () => {
    const reviewedState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    reviewedState.visit.entries = reviewedState.visit.entries.map((entry) => ({
      ...entry,
      reviewed: true,
    }));
    mockImportState = reviewedState;

    act(() => {
      root.render(<App />);
    });

    expect(container.querySelector('[data-testid="primary-next-action"]')?.textContent).toContain("Finalize archive review");

    act(() => {
      container.querySelector('[data-testid="primary-next-action"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="primary-next-action"]')?.textContent).toContain("Download publish-ready output");

    act(() => {
      container.querySelector('[data-testid="primary-next-action"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
  });

  it("reflects story, favorite and hero curation in gallery and action labels", () => {
    act(() => {
      root.render(<App />);
    });

    const findButtonByText = (text: string) =>
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === text);

    act(() => {
      container.querySelector('[data-testid="primary-next-action"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Mark as favorite")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Mark as hero")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Select for Story")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Mark entry reviewed")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Next")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Mark entry reviewed")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Back to archive")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Favorite");
    expect(container.textContent).toContain("Hero");
    expect(container.textContent).toContain("Story");
    expect(container.textContent).toContain("Remove from Story");
  });

  it("supports category-first overview filtering and Story selection before opening Entry Review", () => {
    act(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("All AI categories");

    const categorySelect = container.querySelector('select[aria-label="AI suggestion category filter"]') as HTMLSelectElement | null;
    expect(categorySelect).toBeDefined();

    act(() => {
      if (categorySelect) {
        categorySelect.value = "needs-review";
      }
      categorySelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.querySelectorAll(".preview-card-button")).toHaveLength(1);

    const storySelectButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Select for Story"
    );

    act(() => {
      storySelectButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Remove from Story");
    expect(container.textContent).toContain("Story");
  });

  it("shows Place Discovery summary after ZIP import", () => {
    act(() => {
      root.render(<App />);
    });

    const summary = container.querySelector('[data-testid="vision-engine-summary"]');

    expect(summary).toBeDefined();
    expect(summary?.textContent).toContain("Place Discovery");
    expect(summary?.textContent).toContain("2 images processed for place discovery");
    expect(summary?.textContent).toContain("1 candidate place groups");
  });

  it("renders representative and preview thumbnails for Vision candidate place groups", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const representativeImage = container.querySelector('[data-testid="vision-group-representative-vision-place-1"] img') as HTMLImageElement | null;
    const previewImages = Array.from(container.querySelectorAll('[data-testid="vision-group-preview-strip-vision-place-1"] img')) as HTMLImageElement[];

    expect(representativeImage).toBeTruthy();
    expect(representativeImage?.src).toContain("data:image/gif;base64,");
    expect(representativeImage?.getAttribute("data-object-fit")).toBe("contain");
    expect(previewImages.length).toBeGreaterThan(0);
    expect(previewImages[0]?.src).toContain("data:image/gif;base64,");
    expect(previewImages[0]?.getAttribute("data-object-fit")).toBe("contain");
  });

  it("opens the representative Vision candidate photograph in Entry Review", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const representativeButton = container.querySelector('[data-testid="vision-group-representative-vision-place-1"]') as HTMLButtonElement | null;
    expect(representativeButton).toBeTruthy();

    act(() => {
      representativeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");

    const backButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Back to archive");
    expect(backButton).toBeTruthy();

    act(() => {
      backButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="vision-engine-summary"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="vision-group-card-vision-place-1"]')).toBeTruthy();
  });

  it("opens a preview-strip Vision candidate photograph in Entry Review", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const previewButton = container.querySelector('[data-testid="vision-group-preview-vision-place-1-image-1"]') as HTMLButtonElement | null;
    expect(previewButton).toBeTruthy();

    act(() => {
      previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 1 of 2");
    expect(container.textContent).toContain("courtyard-01.jpg");
  });

  it("caps the actionable review set at MAX_PLACE_APPROVAL_BATCH_SIZE for a large candidate group", async () => {
    mockImportState = buildLargeVisionGroupState(78);

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    expect(container.textContent).toContain("78 photographs");
    expect(container.textContent).toContain("Reviewing 10 of 78 · 68 remaining");
    expect(container.textContent).toContain("Approve place for 10 photographs");

    const representativeImage = container.querySelector('[data-testid="vision-group-representative-vision-place-1"] img') as HTMLImageElement | null;
    expect(representativeImage).toBeTruthy();

    const previewButtons = container.querySelectorAll('[data-testid="vision-group-preview-strip-vision-place-1"] .vision-engine-group-preview-wrapper');
    expect(previewButtons.length).toBe(9);

    // Only images 1-10 (representative + 9 previews) may be present; nothing from later batches leaks in.
    for (let index = 11; index <= 78; index += 1) {
      expect(container.querySelector(`[data-testid="vision-group-preview-vision-place-1-image-${index}"]`)).toBeNull();
    }
  });

  it("approves exactly the visible 10-photograph batch and leaves 68 unassigned for later review", async () => {
    mockImportState = buildLargeVisionGroupState(78);

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;
    const approveButton = container.querySelector('[data-testid="vision-place-approve-vision-place-1"]') as HTMLButtonElement | null;

    act(() => {
      if (placeSelect) placeSelect.value = "house-wall";
      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Assigned The Bicycle Trellis Bed to 10 photographs.");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const persistedSnapshot = await loadArchiveState();
    const placeByRecordId = new Map(
      (persistedSnapshot?.importVisit?.imageRecords ?? []).map((record) => [record.id, record.placeId])
    );

    for (let index = 1; index <= 10; index += 1) {
      expect(placeByRecordId.get(`image-${index}`)).toBe("house-wall");
    }

    let unassignedCount = 0;
    for (let index = 11; index <= 78; index += 1) {
      if (!placeByRecordId.get(`image-${index}`)) {
        unassignedCount += 1;
      }
    }

    expect(unassignedCount).toBe(68);
  });

  it("reduces the visible batch on exclusion without backfilling an unseen photograph", async () => {
    mockImportState = buildLargeVisionGroupState(78);

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const memberRemoveButton = container.querySelector(
      '[data-testid="vision-group-preview-vision-place-1-image-5"]'
    )?.parentElement?.querySelector(".vision-engine-group-remove-image") as HTMLButtonElement | null;
    expect(memberRemoveButton).toBeTruthy();

    act(() => {
      memberRemoveButton?.click();
    });

    expect(container.textContent).toContain("Reviewing 9 of 77 · 68 remaining");
    expect(container.textContent).toContain("Approve place for 9 photographs");
    expect(container.querySelector('[data-testid="vision-group-preview-vision-place-1-image-5"]')).toBeNull();
    // Excluding image-5 must not silently promote image-11 into this batch.
    expect(container.querySelector('[data-testid="vision-group-preview-vision-place-1-image-11"]')).toBeNull();
  });

  it("advances to a batch containing no already-approved images and resets the place selection", async () => {
    mockImportState = buildLargeVisionGroupState(78);

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;
    const approveButton = container.querySelector('[data-testid="vision-place-approve-vision-place-1"]') as HTMLButtonElement | null;

    act(() => {
      if (placeSelect) placeSelect.value = "house-wall";
      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Reviewing 10 of 68 · 58 remaining");

    for (let index = 1; index <= 10; index += 1) {
      expect(container.querySelector(`[data-testid="vision-group-preview-vision-place-1-image-${index}"]`)).toBeNull();
    }
    for (let index = 12; index <= 20; index += 1) {
      expect(container.querySelector(`[data-testid="vision-group-preview-vision-place-1-image-${index}"]`)).toBeTruthy();
    }

    const placeSelectAfter = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;
    expect(placeSelectAfter?.value ?? "").toBe("");

    const approveButtonAfter = container.querySelector('[data-testid="vision-place-approve-vision-place-1"]') as HTMLButtonElement | null;
    expect(approveButtonAfter?.disabled).toBe(true);
  });

  it("eventually makes every photograph in a 78-image cluster reachable across successive approval batches", async () => {
    mockImportState = buildLargeVisionGroupState(78);

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    for (let iteration = 0; iteration < 8; iteration += 1) {
      const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;

      if (!placeSelect) {
        break;
      }

      act(() => {
        placeSelect.value = "house-wall";
        placeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const approveButton = container.querySelector('[data-testid="vision-place-approve-vision-place-1"]') as HTMLButtonElement | null;

      act(() => {
        approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    // Once every photograph in the cluster is assigned, discovery no longer surfaces
    // it as a candidate group (it needs >= 2 unassigned members to cluster).
    expect(container.textContent).toContain("0 candidate place groups");
    expect(container.querySelector('[data-testid="vision-group-card-vision-place-1"]')).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const persistedSnapshot = await loadArchiveState();
    const placeByRecordId = new Map(
      (persistedSnapshot?.importVisit?.imageRecords ?? []).map((record) => [record.id, record.placeId])
    );

    for (let index = 1; index <= 78; index += 1) {
      expect(placeByRecordId.get(`image-${index}`)).toBe("house-wall");
    }
  });

  it("excludes the representative on X click, decrements the batch count, and promotes a new representative", async () => {
    mockImportState = buildLargeVisionGroupState(78);

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    expect(container.textContent).toContain("Reviewing 10 of 78 · 68 remaining");

    const representativeRemoveButtonBefore = container.querySelector(
      '[data-testid="vision-group-card-vision-place-1"] .vision-engine-group-remove-representative'
    ) as HTMLButtonElement | null;
    const originalRepresentativeLabel = representativeRemoveButtonBefore?.getAttribute("aria-label");

    act(() => {
      representativeRemoveButtonBefore?.click();
    });

    expect(container.textContent).toContain("Reviewing 9 of 77 · 68 remaining");

    const newRepresentativeImage = container.querySelector('[data-testid="vision-group-representative-vision-place-1"] img') as HTMLImageElement | null;
    expect(newRepresentativeImage).toBeTruthy();

    const representativeRemoveButtonAfter = container.querySelector(
      '[data-testid="vision-group-card-vision-place-1"] .vision-engine-group-remove-representative'
    ) as HTMLButtonElement | null;
    expect(representativeRemoveButtonAfter?.getAttribute("aria-label")).not.toBe(originalRepresentativeLabel);

    const excludedFilenameMatch = originalRepresentativeLabel?.match(/^Remove (.+) from this place group$/);
    const excludedFilename = excludedFilenameMatch?.[1];
    expect(excludedFilename).toBeTruthy();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const persistedSnapshot = await loadArchiveState();
    const persistedFilenames = (persistedSnapshot?.importVisit?.imageRecords ?? []).map((record) => record.filename);
    expect(persistedFilenames).toContain(excludedFilename);
  });


  it("uses SVG thumbnail fallback in Vision candidate cards when thumbnails are unavailable", async () => {
    const fallbackState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    fallbackState.visit.imageRecords = (fallbackState.visit.imageRecords ?? []).map((record) => {
      const { thumbnailUrl: _thumbnailUrl, ...recordWithoutThumbnail } = record;
      return recordWithoutThumbnail;
    });
    mockImportState = fallbackState;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const representativeImage = container.querySelector('[data-testid="vision-group-representative-vision-place-1"] img') as HTMLImageElement | null;
    expect(representativeImage).toBeTruthy();
    expect(representativeImage?.src).toContain("data:image/svg+xml");
  });

  it("approves a canonical place for a Vision candidate group and persists the assignment", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;
    const approveButton = container.querySelector('[data-testid="vision-place-approve-vision-place-1"]') as HTMLButtonElement | null;

    expect(placeSelect).toBeDefined();
    expect(approveButton).toBeDefined();

    act(() => {
      if (placeSelect) {
        placeSelect.value = "house-wall";
      }

      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(approveButton?.disabled).toBe(false);

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Assigned The Bicycle Trellis Bed to 2 photographs.");
    expect(container.textContent).toContain("The Bicycle Trellis Bed");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    mockImportState = { summary: null, visit: null };
    hasEmittedImportState = false;

    act(() => {
      root.unmount();
    });

    root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    await waitForArchiveHydration();

    expect(container.textContent).toContain("The Bicycle Trellis Bed");
  });

  it("applies assignment to all unassigned records in a group, never overwrites approved records, and keeps publish output consistent", async () => {
    const mixedState = JSON.parse(JSON.stringify(importedArchiveState)) as { summary: ZipImportSummary; visit: Visit };
    mixedState.summary.imageCount = 3;
    mixedState.summary.totalImageSize = 36;
    mixedState.summary.imageFiles = ["courtyard-01.jpg", "courtyard-02.jpg", "courtyard-03.jpg"];

    mixedState.visit.imageCount = 3;
    mixedState.visit.imageRecords = [
      {
        ...(mixedState.visit.imageRecords?.[0] ?? {
          id: "image-1",
          importBatchId: "batch-1",
          filename: "courtyard-01.jpg",
          fileSize: 12,
          format: "jpeg",
          sourcePath: "courtyard-01.jpg",
          timelineIndex: 0,
        }),
        placeId: "parking",
      },
      ...(mixedState.visit.imageRecords?.slice(1) ?? []),
      {
        id: "image-3",
        importBatchId: "batch-1",
        filename: "courtyard-03.jpg",
        fileSize: 12,
        format: "jpeg",
        sourcePath: "courtyard-03.jpg",
        timelineIndex: 2,
        thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
      },
    ];

    mixedState.visit.entries = [
      ...(mixedState.visit.entries ?? []),
      {
        id: "entry-3",
        imageRecordId: "image-3",
        visitId: "visit-1",
        status: "new",
        notes: "",
        tags: [],
        observations: [],
        analysisSuggestions: {
          engine: "mock-observation-engine",
          generatedAt: "2026-07-08T00:00:00.000Z",
          confidence: 0.72,
          categories: ["by-place", "needs-review"],
        },
        reviewed: false,
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    ];

    mockImportState = mixedState;

    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    expect(container.textContent).toContain("2 images processed for place discovery");

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;
    const approveButton = container.querySelector('[data-testid="vision-place-approve-vision-place-1"]') as HTMLButtonElement | null;

    expect(placeSelect).toBeDefined();
    expect(approveButton).toBeDefined();

    act(() => {
      if (placeSelect) {
        placeSelect.value = "house-wall";
      }

      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Assigned The Bicycle Trellis Bed to 2 photographs.");
    expect(container.textContent).toContain("The Bicycle Trellis Bed");
    expect(container.textContent).toContain("0 images processed for place discovery");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const persistedSnapshot = await loadArchiveState();
    const persistedVisit = persistedSnapshot?.importVisit;

    expect(persistedVisit).toBeTruthy();

    const placeByRecordId = new Map((persistedVisit?.imageRecords ?? []).map((record) => [record.id, record.placeId]));

    expect(placeByRecordId.get("image-1")).toBe("parking");
    expect(placeByRecordId.get("image-2")).toBe("house-wall");
    expect(placeByRecordId.get("image-3")).toBe("house-wall");

    if (!persistedVisit) {
      throw new Error("Expected persisted visit");
    }

    const publishOutput = createPublishReadyVisitOutput(persistedVisit, "2026-08-04T12:00:00.000Z");
    const placeByFilename = new Map(
      publishOutput.entries
        .filter((entry) => entry.image)
        .map((entry) => [entry.image?.filename ?? "", entry.image?.placeId])
    );

    expect(placeByFilename.get("courtyard-01.jpg")).toBe("parking");
    expect(placeByFilename.get("courtyard-02.jpg")).toBe("house-wall");
    expect(placeByFilename.get("courtyard-03.jpg")).toBe("house-wall");
  });

  it("shows a resolved state instead of approval when all group photographs are already assigned", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const removeButtons = Array.from(container.querySelectorAll('[data-testid^="vision-group-preview-vision-place-1-"]'))
      .map((preview) => preview.parentElement?.querySelector(".vision-engine-group-remove-image") as HTMLButtonElement | null)
      .filter((button): button is HTMLButtonElement => Boolean(button));
    const representativeRemoveButton = container.querySelector(
      '[data-testid="vision-group-card-vision-place-1"] .vision-engine-group-remove-representative'
    ) as HTMLButtonElement | null;

    act(() => {
      representativeRemoveButton?.click();
      removeButtons.forEach((button) => button.click());
    });

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;
    act(() => {
      if (placeSelect) placeSelect.value = "rock-garden";
      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="vision-place-approve-vision-place-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="vision-place-approval-resolved-vision-place-1"]')?.textContent).toBe("Already assigned");
  });

  it("uses living-map.png as the place discovery map reference", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;

    act(() => {
      if (placeSelect) {
        placeSelect.value = "seating-area";
      }
      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const showMapButton = container.querySelector('[data-testid="vision-place-map-toggle-vision-place-1"]') as HTMLButtonElement | null;
    act(() => {
      showMapButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const mapImage = container.querySelector(".place-map-svg image") as SVGImageElement | null;
    expect(mapImage).toBeTruthy();
    const href = mapImage?.getAttribute("href") || mapImage?.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    expect(href).toBe("/images/living-map.png");
  });

  it("highlights calibrated canonical place hotspot on the map", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;

    // Select a calibrated place (house-wall is marked calibrated: true)
    act(() => {
      if (placeSelect) {
        placeSelect.value = "house-wall";
      }
      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const showMapButton = container.querySelector('[data-testid="vision-place-map-toggle-vision-place-1"]') as HTMLButtonElement | null;
    act(() => {
      showMapButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Look for the active hotspot circle for calibrated place
    const activeHotspot = container.querySelector(".place-map-hotspot-active");
    expect(activeHotspot).toBeTruthy();

    // No calibration notice should appear for calibrated place
    const calibrationNotice = container.querySelector(".place-map-calibration-notice");
    expect(calibrationNotice).toBeFalsy();
  });

  it("shows calibration notice for uncalibrated canonical place", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;

    // Select an uncalibrated place (parking is marked calibrated: false)
    act(() => {
      if (placeSelect) {
        placeSelect.value = "parking";
      }
      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const showMapButton = container.querySelector('[data-testid="vision-place-map-toggle-vision-place-1"]') as HTMLButtonElement | null;
    act(() => {
      showMapButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Hotspot should NOT be active for uncalibrated place
    const activeHotspot = container.querySelector(".place-map-hotspot-active");
    expect(activeHotspot).toBeFalsy();

    // Calibration notice should appear
    const calibrationNotice = container.querySelector(".place-map-calibration-notice");
    expect(calibrationNotice).toBeTruthy();
    expect(calibrationNotice?.textContent).toBe("Click the map to choose a position. Save to calibrate this place.");
  });

  it("allows place approval regardless of calibration status", async () => {
    act(() => {
      root.render(<App />);
    });

    await waitForArchiveHydration();

    const placeSelect = container.querySelector('[data-testid="vision-place-select-vision-place-1"]') as HTMLSelectElement | null;

    // Select an uncalibrated place
    act(() => {
      if (placeSelect) {
        placeSelect.value = "parking";
      }
      placeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const approveButton = container.querySelector('[data-testid="vision-place-approve-vision-place-1"]') as HTMLButtonElement | null;
    expect(approveButton?.disabled).toBe(false);

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Should approve successfully even though parking is not yet calibrated
    expect(container.textContent).toContain("Assigned Parking Edge — needs reassignment");
  });

  it("keeps unassigned photographs backward compatible with Unknown place labels", () => {
    act(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Unknown");
  });

  it("filters timeline by import batch and clears batch filter", () => {
    act(() => {
      root.render(<App />);
    });

    const batchButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("draft.zip")
    );
    expect(batchButton).toBeDefined();

    act(() => {
      batchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Batch filter is active.");

    const clearFilterButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Clear filter"
    );
    expect(clearFilterButton).toBeDefined();

    act(() => {
      clearFilterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Batch filter is active.");
  });

  it("shows accurate wording, capture range, and review status for a duplicate-only batch", () => {
    const duplicateOnlyState = JSON.parse(JSON.stringify(importedArchiveState)) as {
      summary: ZipImportSummary;
      visit: Visit;
    };
    const visit = duplicateOnlyState.visit;

    visit.imageRecords = (visit.imageRecords ?? []).map((record) => ({
      ...record,
      captureDate: record.id === "image-1" ? "2026-07-08T10:00:00.000Z" : "2026-07-09T10:00:00.000Z",
      additionalOccurrences: [
        {
          importBatchId: "batch-2",
          filename: record.filename,
          sourcePath: record.sourcePath,
          importedAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    }));
    visit.importBatches = [
      ...(visit.importBatches ?? []),
      {
        id: "batch-2",
        fileName: "batch_01_batch_175.zip",
        importedAt: "2026-07-10T00:00:00.000Z",
        imageCount: 0,
        rawImageCount: 2,
        importedImageCount: 0,
        duplicateSkippedCount: 2,
      },
    ];

    mockImportState = { summary: importedArchiveState.summary, visit };

    act(() => {
      root.render(<App />);
    });

    const toggle = container.querySelector('[data-testid="sidebar-batches-toggle"]') as HTMLButtonElement | null;
    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("0 new photographs · 2 matched to existing photographs");
    expect(container.textContent).not.toContain("Capture range: Undated");
    expect(container.textContent).toContain("No new photographs to review");

    const filenameEl = container.querySelector(".batch-item-filename");
    expect(filenameEl).toBeTruthy();
    expect(filenameEl?.textContent).toBe("batch_01_batch_175.zip");
    expect(filenameEl?.parentElement?.className).toContain("batch-item-header");
  });

  it("defaults batch provenance to collapsed when multiple batches exist and allows expanding", () => {
    mockImportState = {
      summary: importedArchiveState.summary,
      visit: {
        ...importedArchiveState.visit,
        importBatches: [
          ...(importedArchiveState.visit.importBatches ?? []),
          {
            id: "batch-2",
            fileName: "summer-part-2.zip",
            importedAt: "2026-07-09T00:00:00.000Z",
            imageCount: 0,
          },
          {
            id: "batch-3",
            fileName: "summer-part-3.zip",
            importedAt: "2026-07-10T00:00:00.000Z",
            imageCount: 0,
          },
        ],
      },
    };

    act(() => {
      root.render(<App />);
    });

    const toggle = container.querySelector('[data-testid="sidebar-batches-toggle"]') as HTMLButtonElement | null;
    expect(toggle).toBeDefined();
    expect(toggle?.textContent).toContain("Batch provenance (3)");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="sidebar-batch-list"]')).toBeNull();

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-testid="sidebar-batch-list"]')).toBeDefined();
    expect(container.textContent).toContain("draft.zip");
  });

  it("stacks the ZIP-ready row vertically and keeps the batch-provenance toggle label on one line", () => {
    act(() => {
      root.render(<App />);
    });

    const zipReadyCard = container.querySelector(".import-summary-mini");
    expect(zipReadyCard).toBeTruthy();
    expect(zipReadyCard?.textContent).toContain("ZIP ready");
    expect(zipReadyCard?.querySelector(".import-summary-mini-filename")).toBeTruthy();

    const toggle = container.querySelector('[data-testid="sidebar-batches-toggle"]');
    expect(toggle?.querySelector(".archive-batches-toggle-label")).toBeTruthy();
    const toggleState = toggle?.querySelector(".archive-batches-toggle-state");
    expect(toggleState).toBeTruthy();
    expect(toggleState?.textContent).toBe("Hide");
  });

  it("shows one clear primary action based on archive state", () => {
    act(() => {
      root.render(<App />);
    });

    const primaryButtons = container.querySelectorAll('[data-testid="primary-next-action"]');
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]?.textContent).toContain("Review AI suggestions");
  });

  it("keeps archive statistics in one place without sidebar duplication", () => {
    act(() => {
      root.render(<App />);
    });

    const totalPhotographsMatches = container.textContent?.match(/Total photographs/g) ?? [];
    expect(totalPhotographsMatches.length).toBe(1);
  });

  it("separates demo collection from real archive when no archive is loaded", () => {
    mockImportState = { summary: null, visit: null };

    act(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Current archive not loaded");
    expect(container.querySelector('[data-testid="demo-collection-label"]')?.textContent).toContain("not part of your archive");
    expect(container.querySelector('[data-testid="primary-next-action"]')?.textContent).toContain("Import photographs");
  });

  it("uses simplified sidebar order: import, batches, drafts", () => {
    act(() => {
      root.render(<App />);
    });

    const importSection = container.querySelector('[data-testid="sidebar-import-section"]');
    const batchesSection = container.querySelector('[data-testid="sidebar-batches-section"]');
    const draftsSection = container.querySelector('[data-testid="sidebar-drafts-section"]');

    expect(importSection).toBeTruthy();
    expect(batchesSection).toBeTruthy();
    expect(draftsSection).toBeTruthy();

    const order = [importSection, batchesSection, draftsSection].map((node) =>
      node ? Array.from(container.querySelectorAll("aside.sidebar section")).indexOf(node as HTMLElement) : -1
    );

    expect(order[0]).toBeLessThan(order[1] ?? 0);
    expect(order[1]).toBeLessThan(order[2] ?? 0);
  });

  it("opens Entry Review from AI inbox suggestions", () => {
    act(() => {
      root.render(<App />);
    });

    expect(container.querySelector('[data-testid="ai-inbox-main"]')).toBeDefined();
    expect(container.textContent).toContain("Story recommendations");

    const inboxSuggestionButton = Array.from(container.querySelectorAll(".ai-suggestion-item")).find((button) =>
      button.textContent?.includes("courtyard-02.jpg")
    );
    expect(inboxSuggestionButton).toBeDefined();

    act(() => {
      inboxSuggestionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");
    expect(container.textContent).toContain("Back to archive");
  });

  it("starts the story-first queue from AI suggestions", () => {
    act(() => {
      root.render(<App />);
    });

    const storyQueueButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Story-first queue")
    );
    expect(storyQueueButton).toBeDefined();
    expect(storyQueueButton?.disabled).toBe(true);
  });

  it("persists Favorite/Hero/Story through save draft and load draft", () => {
    act(() => {
      root.render(<App />);
    });

    const findButtonByText = (text: string) =>
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === text);

    act(() => {
      container.querySelector(".preview-card-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Mark as favorite")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      findButtonByText("Mark as hero")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      findButtonByText("Select for Story")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Save Draft")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Back to archive")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Favorite");
    expect(container.textContent).toContain("Hero");
    expect(container.textContent).toContain("Story");

    const loadDraftButton = Array.from(container.querySelectorAll('[data-testid="sidebar-drafts-section"] button')).find(
      (button) => button.textContent?.includes("entries")
    );
    expect(loadDraftButton).toBeDefined();

    act(() => {
      loadDraftButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Back to archive");
    expect(container.textContent).toContain("Favorite ✓");
    expect(container.textContent).toContain("Hero ✓");
    expect(container.textContent).toContain("Selected for Story ✓");
  });

  it("restores a persisted archive after reload and remount with review state intact", async () => {
    vi.stubGlobal("indexedDB", createInMemoryIndexedDb());

    const persistedVisit = JSON.parse(JSON.stringify(importedArchiveState.visit)) as Visit;
    persistedVisit.entries = persistedVisit.entries.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            notes: "Persisted archive note",
            favorite: true,
            hero: true,
            storySelected: true,
            reviewed: true,
            observations: [
              {
                id: "obs-persisted-1",
                entryId: entry.id,
                type: "Plant",
                confidence: 0.95,
                source: "user",
                value: "Hydrangea",
                createdAt: "2026-07-08T00:00:00.000Z",
                reviewed: true,
                accepted: true,
              },
            ],
          }
        : entry
    );

    await persistArchiveThumbnailBinaries({
      importVisit: persistedVisit,
      draftWorkspace: {
        drafts: [],
        activeDraftId: null,
      },
    });

    await saveArchiveState(
      createArchiveStateSnapshot({
        importVisit: persistedVisit,
        draftWorkspace: {
          drafts: [],
          activeDraftId: null,
        },
      })
    );

    mockImportState = { summary: null, visit: null };
    hasEmittedImportState = false;

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Current archive");
    expect(container.textContent).toContain("Export archive backup");

    await waitForArchiveHydration();

    const restoredGalleryThumb = container.querySelector(".gallery-card-thumb img") as HTMLImageElement | null;
    expect(restoredGalleryThumb?.src).toContain("blob:mock-url");
    expect(restoredGalleryThumb?.src).not.toContain("data:image/svg+xml");

    await openFirstPreviewCardForRestoredArchive();

    expect(container.textContent).toContain("Entry 1 of 2");
    expect((container.querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe("Persisted archive note");
    expect(container.textContent).toContain("Favorite ✓");
    expect(container.textContent).toContain("Hero ✓");
    expect(container.textContent).toContain("Selected for Story ✓");
    expect(container.textContent).toContain("1 observations");
    expect((container.querySelector('[data-testid="entry-review-main-image"]') as HTMLImageElement | null)?.src).toContain("blob:mock-url");
    expect(createObjectUrlSpy).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:mock-url");

    root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    await openFirstPreviewCardForRestoredArchive();

    expect(container.textContent).toContain("Entry 1 of 2");
    expect((container.querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe("Persisted archive note");
    expect(container.textContent).toContain("Favorite ✓");
    expect(container.textContent).toContain("Hero ✓");
    expect(container.textContent).toContain("Selected for Story ✓");
    expect((container.querySelector('[data-testid="entry-review-main-image"]') as HTMLImageElement | null)?.src).toContain("blob:mock-url");
  });
});