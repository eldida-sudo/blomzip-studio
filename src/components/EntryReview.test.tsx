/**
 * @vitest-environment jsdom
 */

import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useState } from "react";
import { EntryReview } from "./EntryReview";
import { MockObservationEngine } from "./observationEngine";
import type { Visit } from "../models/blomzip";

const visit: Visit = {
  id: "visit-1",
  placeId: "place-1",
  date: "2026-07-05",
  entries: [
    {
      id: "entry-1",
      imageRecordId: "image-1",
      visitId: "visit-1",
      status: "new",
      notes: "",
      tags: [],
      observations: [
        {
          id: "obs-ai-1",
          entryId: "entry-1",
          type: "Plant",
          confidence: 0.9,
          source: "mock-ai",
          value: "Hydrangea-like bloom",
          createdAt: "2026-07-05T00:00:00.000Z",
          reviewed: false,
        },
      ],
      analysisSuggestions: {
        engine: "mock-observation-engine",
        generatedAt: "2026-07-05T00:00:00.000Z",
        confidence: 0.87,
        categories: ["story-candidate", "by-place", "possible-duplicates"],
        possibleDuplicateEntryIds: ["entry-2"],
      },
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    },
    {
      id: "entry-2",
      imageRecordId: "image-2",
      visitId: "visit-1",
      status: "new",
      notes: "",
      tags: [],
      observations: [],
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    },
  ],
  imageRecords: [
    {
      id: "image-1",
      filename: "courtyard-01.jpg",
      fileSize: 1200,
      format: "jpeg",
      sourcePath: "courtyard/courtyard-01.jpg",
      width: 1600,
      height: 1200,
      orientation: "landscape",
      mimeType: "image/jpeg",
      timelineIndex: 0,
      captureDate: "2026-07-05T10:30:00.000Z",
      thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
    },
    {
      id: "image-2",
      filename: "courtyard-02.jpg",
      fileSize: 1600,
      format: "jpeg",
      sourcePath: "courtyard/courtyard-02.jpg",
      width: 1200,
      height: 1600,
      orientation: "portrait",
      mimeType: "image/jpeg",
      timelineIndex: 1,
      thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
    },
  ],
  imageCount: 2,
  status: "Ready for AI",
};

describe("EntryReview", () => {
  let container: HTMLDivElement;
  let root: Root;

  function getReactProps<ElementType extends Element>(element: ElementType) {
    const propKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
    if (!propKey) {
      return null;
    }

    return (element as ElementType & { [key: string]: any })[propKey] as any;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders a compact review header with back to archive wording", () => {
    act(() => {
      root.render(<EntryReview visit={visit} onClose={vi.fn()} />);
    });

    expect(container.querySelector('[data-testid="entry-review-header"]')).toBeDefined();
    expect(container.textContent).toContain("Back to archive");
    expect(container.textContent).toContain("Entry");
    expect(container.textContent).toContain("1 of 2");
    expect(container.textContent).toContain("Save status");
    expect(container.textContent).toContain("Review progress");
    expect(container.textContent).not.toContain("Workflow:");
    expect(container.textContent).not.toContain("Next:");
    expect(container.textContent).not.toContain("Finalize visit");
  });

  it("renders the complete image in a bounded region", () => {
    act(() => {
      root.render(<EntryReview visit={visit} />);
    });

    const imageRegion = container.querySelector('[data-testid="entry-review-image-region"]');
    const image = container.querySelector('[data-testid="entry-review-main-image"]') as HTMLImageElement | null;

    expect(imageRegion).toBeDefined();
    expect(image).toBeDefined();
    expect(image?.className).toContain("entry-review-preview-image");
    expect(image?.getAttribute("alt")).toBe("courtyard-01.jpg");
  });

  it("shows AI suggestions fields when analysis suggestions exist", () => {
    const html = renderToStaticMarkup(<EntryReview visit={visit} />);

    expect(html).toContain("AI suggestions");
    expect(html).toContain("Suggested place");
    expect(html).toContain("Categories");
    expect(html).toContain("Confidence");
    expect(html).toContain("Reason");
    expect(html).toContain("Suggested observations");
    expect(html).toContain("Possible duplicates");
  });

  it("does not show AI suggestion panel when no analysis suggestions exist", () => {
    const html = renderToStaticMarkup(
      <EntryReview
        visit={{
          ...visit,
          entries: [{ ...visit.entries[0], analysisSuggestions: undefined }, visit.entries[1]],
        }}
      />
    );

    expect(html).not.toContain("AI suggestions");
    expect(html).not.toContain("Suggested place");
  });

  it("keeps Previous and Next in one unified navigation region without duplication", () => {
    act(() => {
      root.render(<EntryReview visit={visit} />);
    });

    const nav = container.querySelector('[data-testid="entry-review-navigation"]');
    const allPreviousButtons = Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "Previous");
    const allNextButtons = Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "Next");

    expect(nav).toBeDefined();
    expect(nav?.textContent).toContain("Entry 1 of 2");
    expect(allPreviousButtons).toHaveLength(1);
    expect(allNextButtons).toHaveLength(1);
    expect(container.textContent).not.toContain("Next image");
  });

  it("renders review controls in the expected vertical order", () => {
    act(() => {
      root.render(<EntryReview visit={visit} />);
    });

    const panel = container.querySelector('[data-testid="entry-review-panel"]') as HTMLElement | null;
    const sequence = [
      "panel-filename",
      "panel-captured-date",
      "panel-essential-metadata",
      "panel-ai-suggestions",
      "panel-notes",
      "panel-tags",
      "panel-curation-controls",
      "panel-observations",
      "panel-mark-reviewed",
    ].map((testId) => panel?.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null);

    expect(sequence.every(Boolean)).toBe(true);

    const order = sequence.map((node) => Array.from(panel?.children ?? []).indexOf(node as Element));
    for (let index = 0; index < order.length - 1; index += 1) {
      expect(order[index]).toBeLessThan(order[index + 1] ?? 0);
    }
  });

  it("keeps current entry selected while editing notes and tags", () => {
    const onEntryUpdated = vi.fn();

    function StatefulReview() {
      const [statefulVisit, setStatefulVisit] = useState(visit);

      return (
        <EntryReview
          visit={statefulVisit}
          onEntryUpdated={(updatedEntry) => {
            onEntryUpdated(updatedEntry);
            setStatefulVisit((currentVisit) => ({
              ...currentVisit,
              entries: currentVisit.entries.map((entryItem) =>
                entryItem.id === updatedEntry.id ? updatedEntry : entryItem
              ),
            }));
          }}
        />
      );
    }

    act(() => {
      root.render(<StatefulReview />);
    });

    const nextButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");

    act(() => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");

    const noteField = container.querySelector("textarea");
    const tagField = Array.from(container.querySelectorAll("input")).find((input) =>
      input.getAttribute("placeholder")?.includes("tags")
    ) as HTMLInputElement | undefined;

    act(() => {
      const noteProps = noteField ? getReactProps(noteField as HTMLTextAreaElement) : null;
      noteProps?.onChange?.({ target: { value: "Updated note" } });
    });

    act(() => {
      const tagProps = tagField ? getReactProps(tagField) : null;
      tagProps?.onChange?.({ target: { value: "tag-a, tag-b" } });
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");
    expect(onEntryUpdated).toHaveBeenCalled();
  });

  it("auto-advances to the next entry after marking the current one reviewed", () => {
    const onEntryUpdated = vi.fn();

    act(() => {
      root.render(<EntryReview visit={visit} onEntryUpdated={onEntryUpdated} />);
    });

    const reviewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Mark entry reviewed"
    );

    act(() => {
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");
    expect(onEntryUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: "entry-1",
      reviewed: true,
    }));
  });

  it("supports keyboard shortcuts for navigation and curation", () => {
    act(() => {
      root.render(<EntryReview visit={visit} />);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 1 of 2");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    });

    expect(container.textContent).toContain("Favorite ✓");
  });

  it("does not trigger keyboard shortcuts while typing in a text field", () => {
    act(() => {
      root.render(<EntryReview visit={visit} />);
    });

    const noteField = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const noteProps = noteField ? getReactProps(noteField) : null;

    act(() => {
      noteProps?.onChange?.({ target: { value: "Typing a note" } });
    });

    act(() => {
      noteField?.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    });

    expect(container.textContent).toContain("Pending review");
    expect(container.textContent).not.toContain("Favorite ✓");
  });

  it("preserves edits while auto-advancing and stops on the final entry", () => {
    function StatefulReview() {
      const [statefulVisit, setStatefulVisit] = useState(visit);

      return (
        <EntryReview
          visit={statefulVisit}
          onEntryUpdated={(updatedEntry) => {
            setStatefulVisit((currentVisit) => ({
              ...currentVisit,
              entries: currentVisit.entries.map((entryItem) =>
                entryItem.id === updatedEntry.id ? updatedEntry : entryItem
              ),
            }));
          }}
        />
      );
    }

    act(() => {
      root.render(<StatefulReview />);
    });

    const noteField = container.querySelector("textarea") as HTMLTextAreaElement | null;
    const noteProps = noteField ? getReactProps(noteField) : null;

    act(() => {
      noteProps?.onChange?.({ target: { value: "Important edit" } });
    });

    act(() => {
      const reviewButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent === "Mark entry reviewed"
      );
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("courtyard-02.jpg");

    act(() => {
      const previousButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Previous");
      previousButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Important edit");

    act(() => {
      const nextButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");

    act(() => {
      const reviewButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent === "Mark entry reviewed"
      );
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Entry 2 of 2");
    expect(container.textContent).toContain("Finalize visit");
  });

  it("toggles Favorite, Hero and Story on and off with clear labels", () => {
    const onEntryUpdated = vi.fn();

    act(() => {
      root.render(<EntryReview visit={visit} onEntryUpdated={onEntryUpdated} />);
    });

    const findButtonByText = (text: string) =>
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === text);

    act(() => {
      findButtonByText("Mark as favorite")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      findButtonByText("Mark as hero")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      findButtonByText("Select for Story")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Favorite ✓");
    expect(container.textContent).toContain("Hero ✓");
    expect(container.textContent).toContain("Selected for Story ✓");

    act(() => {
      findButtonByText("Favorite ✓")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      findButtonByText("Hero ✓")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      findButtonByText("Selected for Story ✓")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Mark as favorite");
    expect(container.textContent).toContain("Mark as hero");
    expect(container.textContent).toContain("Select for Story");
    expect(onEntryUpdated).toHaveBeenCalled();
  });

  it("supports observation accept, edit and reject in the same panel", () => {
    const onEntryUpdated = vi.fn();

    act(() => {
      root.render(<EntryReview visit={visit} onEntryUpdated={onEntryUpdated} />);
    });

    const observationField = container.querySelector(".entry-review-observation-input") as HTMLInputElement | null;
    const acceptButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Accept");

    act(() => {
      const observationProps = observationField ? getReactProps(observationField) : null;
      observationProps?.onChange?.({ target: { value: "Edited observation" } });
    });

    act(() => {
      acceptButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onEntryUpdated).toHaveBeenCalled();
    expect(container.textContent).toContain("Accepted");
  });

  it("marks the current entry as reviewed", () => {
    const onEntryUpdated = vi.fn();

    act(() => {
      root.render(<EntryReview visit={visit} onEntryUpdated={onEntryUpdated} />);
    });

    const reviewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Mark entry reviewed"
    );

    act(() => {
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onEntryUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: "entry-1",
      reviewed: true,
    }));
  });

  it("shows finalize only when relevant and finalizes after all entries are reviewed", () => {
    const onVisitFinalized = vi.fn();

    act(() => {
      root.render(<EntryReview visit={visit} onVisitFinalized={onVisitFinalized} />);
    });

    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Finalize visit")).toBe(false);

    const markReviewed = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Mark entry reviewed"
    );

    act(() => {
      markReviewed?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      const nextButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const secondReviewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Mark entry reviewed"
    );

    act(() => {
      secondReviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const finalizeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Finalize visit"
    );

    expect(finalizeButton).toBeDefined();

    act(() => {
      finalizeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onVisitFinalized).toHaveBeenCalledWith(expect.objectContaining({
      status: "Finalized",
      entries: expect.arrayContaining([
        expect.objectContaining({ reviewed: true }),
        expect.objectContaining({ reviewed: true }),
      ]),
    }));
  });

  it("creates mock observations for the matching entry", () => {
    const observations = new MockObservationEngine().generateObservations("entry-1");

    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((observation) => observation.entryId === "entry-1")).toBe(true);
    expect(observations.every((observation) => observation.source === "mock-ai")).toBe(true);
  });
});
