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
import { createPublishReadyVisitOutput } from "./utils/publishReadyOutput";
import type { ZipImportSummary } from "./utils/readZipImages";

let mockImportState: { summary: ZipImportSummary | null; visit: Visit | null } | null = null;
let hasEmittedImportState = false;

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

vi.mock("./components/ZipImportPanel", () => {
  function MockZipImportPanel({
    onImportStateChange,
  }: {
    onImportStateChange?: (state: { summary: ZipImportSummary | null; visit: Visit | null }) => void;
  }) {
    const onImportStateChangeRef = useRef(onImportStateChange);

    onImportStateChangeRef.current = onImportStateChange;

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

  it("shows Vision Engine Discover Places summary after ZIP import", () => {
    act(() => {
      root.render(<App />);
    });

    const summary = container.querySelector('[data-testid="vision-engine-summary"]');

    expect(summary).toBeDefined();
    expect(summary?.textContent).toContain("Discover Places");
    expect(summary?.textContent).toContain("candidate place groups");
    expect(summary?.textContent).toContain("near duplicates");
    expect(summary?.textContent).toContain("hero candidates");
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

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Assigned The House Wall to 2 photographs.");
    expect(container.textContent).toContain("The House Wall");

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

    expect(container.textContent).toContain("The House Wall");
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

    expect(container.textContent).toContain("2 photographs analyzed");

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

    expect(container.textContent).toContain("Assigned The House Wall to 2 photographs.");
    expect(container.textContent).toContain("The House Wall");
    expect(container.textContent).toContain("0 photographs analyzed");

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

  it("shows one clear primary action based on archive state", () => {
    act(() => {
      root.render(<App />);
    });

    const primaryButtons = container.querySelectorAll('[data-testid="primary-next-action"]');
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]?.textContent).toContain("Select Story candidates");
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
    expect(container.textContent).toContain("Story candidates");

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

    act(() => {
      storyQueueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");
    expect(container.textContent).toContain("Back to archive");
  });

  it("persists Favorite/Hero/Story through save draft and load draft", () => {
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

    const nextButtonInReview = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");

    act(() => {
      nextButtonInReview?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Back to archive");
    expect(container.textContent).toContain("Favorite ✓");
    expect(container.textContent).toContain("Hero ✓");
    expect(container.textContent).toContain("Selected for Story ✓");
  });

  it("restores a persisted archive after reload and remount with review state intact", async () => {
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

    await openFirstPreviewCardForRestoredArchive();

    expect(container.textContent).toContain("Entry 1 of 2");
    expect((container.querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe("Persisted archive note");
    expect(container.textContent).toContain("Favorite ✓");
    expect(container.textContent).toContain("Hero ✓");
    expect(container.textContent).toContain("Selected for Story ✓");
    expect(container.textContent).toContain("1 observations");

    act(() => {
      root.unmount();
    });

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
  });
});