/**
 * @vitest-environment jsdom
 */

import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
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
      observations: [],
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
      sourcePath: "courtyard-01.jpg",
      width: 1600,
      height: 1200,
      orientation: "landscape",
      mimeType: "image/jpeg",
      timelineIndex: 0,
      thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
    },
    {
      id: "image-2",
      filename: "courtyard-02.jpg",
      fileSize: 1600,
      format: "jpeg",
      sourcePath: "courtyard-02.jpg",
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

  it("renders entry review details and review controls", () => {
    const html = renderToStaticMarkup(<EntryReview visit={visit} />);

    expect(html).toContain("Entry review");
    expect(html).toContain("courtyard-01.jpg");
    expect(html).toContain("Timeline index");
    expect(html).toContain("0 observations");
    expect(html).toContain("Ready for AI");
    expect(html).toContain("Notes");
    expect(html).toContain("Tags");
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
    expect(html).toContain("Analyze image");
  });

  it("creates mock observations for the matching entry", () => {
    const observations = new MockObservationEngine().generateObservations("entry-1");

    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((observation) => observation.entryId === "entry-1")).toBe(true);
    expect(observations.every((observation) => observation.source === "mock-ai")).toBe(true);
  });

  it("hides the analyze button once observations exist", () => {
    const html = renderToStaticMarkup(
      <EntryReview
        visit={{
          ...visit,
          entries: [
            {
              ...visit.entries[0],
              observations: [
                {
                  id: "obs-1",
                  entryId: "entry-1",
                  type: "Plant",
                  confidence: 0.98,
                  source: "mock-ai",
                  value: "Flower",
                  createdAt: "2026-07-05T00:00:00.000Z",
                  reviewed: false,
                },
              ],
            },
            ...visit.entries.slice(1),
          ],
        }}
      />
    );

    expect(html).toContain("1 observations");
    expect(html).toContain("Observation created");
    expect(html).toContain("Mock observation");
    expect(html).not.toContain("Analyze image");
  });

  it("renders note and tag fields and the analyze control", () => {
    act(() => {
      root.render(<EntryReview visit={visit} />);
    });

    expect(container.innerHTML).toContain("textarea");
    expect(container.innerHTML).toContain("placeholder=\"Add tags, separated by commas\"");
    expect(container.innerHTML).toContain("Analyze image");
  });

  it("renders observation review controls when observations exist", () => {
    act(() => {
      root.render(
        <EntryReview
          visit={{
            ...visit,
            entries: [
              {
                ...visit.entries[0],
                observations: [
                  {
                    id: "obs-1",
                    entryId: "entry-1",
                    type: "Plant",
                    confidence: 0.8,
                    source: "mock-ai",
                    value: "Flower",
                    createdAt: "2026-07-05T00:00:00.000Z",
                    reviewed: false,
                  },
                ],
              },
            ],
          }}
        />
      );
    });

    expect(container.innerHTML).toContain("1 observations");
    expect(container.innerHTML).toContain("Accept");
    expect(container.innerHTML).toContain("Reject");
    expect(container.innerHTML).toContain("Pending review");
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

  it("invokes the save draft action when requested", () => {
    const onSaveDraft = vi.fn();

    act(() => {
      root.render(<EntryReview visit={visit} onSaveDraft={onSaveDraft} />);
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Save Draft"
    );

    act(() => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("shows visit progress and disables finalize until all entries are reviewed", () => {
    const onVisitFinalized = vi.fn();

    act(() => {
      root.render(<EntryReview visit={visit} onVisitFinalized={onVisitFinalized} />);
    });

    expect(container.textContent).toContain("0 of 2 entries reviewed (0%)");

    const finalizeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Finalize visit"
    );

    expect(finalizeButton).toBeDefined();
    expect(finalizeButton?.hasAttribute("disabled")).toBe(true);
  });

  it("finalizes the visit when all entries are reviewed", () => {
    const onVisitFinalized = vi.fn();

    act(() => {
      root.render(<EntryReview visit={visit} onVisitFinalized={onVisitFinalized} />);
    });

    const markReviewed = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Mark entry reviewed"
    );

    act(() => {
      markReviewed?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      const nextButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent === "Next"
      );
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const secondReviewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Mark entry reviewed"
    );

    act(() => {
      secondReviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      const finalizeButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent === "Finalize visit"
      );
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
});
