/**
 * @vitest-environment jsdom
 */

import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { initialImages } from "./data/demoImages";
import type { Visit } from "./models/blomzip";
import type { ZipImportSummary } from "./utils/readZipImages";

vi.mock("./components/ZipImportPanel", () => {
  function MockZipImportPanel({
    onImportStateChange,
  }: {
    onImportStateChange?: (state: { summary: ZipImportSummary | null; visit: Visit | null }) => void;
  }) {
    const onImportStateChangeRef = useRef(onImportStateChange);

    onImportStateChangeRef.current = onImportStateChange;

    useEffect(() => {
      onImportStateChangeRef.current?.({
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
          imageRecords: [
            {
              id: "image-1",
              filename: "courtyard-01.jpg",
              fileSize: 12,
              format: "jpeg",
              sourcePath: "courtyard-01.jpg",
              timelineIndex: 0,
              thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
            },
            {
              id: "image-2",
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
              reviewed: false,
              createdAt: "2026-07-08T00:00:00.000Z",
              updatedAt: "2026-07-08T00:00:00.000Z",
            },
          ],
          status: "Ready for AI",
        },
      });
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

  afterEach(() => {
    act(() => {
      root.unmount();
    });

    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens EntryReview at the clicked preview thumbnail", () => {
    act(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("Current draft");
    expect(container.textContent).toContain("Review entries");
    expect(container.textContent).toContain("Workflow: Curate thumbnails");
    expect(container.textContent).toContain("Next: Open Entry Review");
    expect(container.textContent).toContain("courtyard-01.jpg");
    expect(container.textContent).toContain("courtyard-02.jpg");
    expect(container.textContent).toContain("Imported ZIP");
    expect(container.textContent).not.toContain("Stockrosor");
    expect(container.textContent).not.toContain("Rabatt vid husvägg");
    expect(container.querySelector("textarea")).toBeNull();

    const previewButtons = Array.from(container.querySelectorAll(".preview-card-button"));
    expect(previewButtons).toHaveLength(2);

    act(() => {
      previewButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry review");
    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");
    expect(container.textContent).toContain("Workflow: Entry Review");
    expect(container.textContent).toContain("Next: Continue reviewing entries");
  });

  it("shows finalize readiness after all entries are reviewed and allows finalizing from gallery", () => {
    act(() => {
      root.render(<App />);
    });

    const openReviewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Review entries"
    );

    act(() => {
      openReviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const findButtonByText = (text: string) =>
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === text);

    act(() => {
      findButtonByText("Mark entry reviewed")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Next")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      findButtonByText("Mark entry reviewed")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Workflow: Review status complete");
    expect(container.textContent).toContain("Next: Finalize visit");

    act(() => {
      findButtonByText("Back to import")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Workflow: Review status complete");
    expect(container.textContent).toContain("Next: Finalize visit");
    expect(container.textContent).toContain("Review status complete");

    act(() => {
      findButtonByText("Finalize visit")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Next: Download publish-ready output");
    expect(container.textContent).toContain("Download publish-ready JSON");
    expect(container.textContent).toContain("Finalized");

    act(() => {
      findButtonByText("Download publish-ready JSON")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
  });
});