/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceTrainingState, Visit } from "../models/blomzip";
import { createEmptyPlaceTrainingState, createMatchResultId, upsertMatchResult } from "../utils/placeTraining";
import type { VisionProvider } from "../utils/visionProvider";
import { PlaceSortingQueue } from "./PlaceSortingQueue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLACES = ["seating-area", "raised-bed", "house-wall"];

function build(): { visit: Visit; training: PlaceTrainingState } {
  let training = createEmptyPlaceTrainingState();
  PLACES.forEach((placeId) => {
    training.anchorsByPlaceId[placeId] = [1, 2, 3].map((n) => ({
      id: `${placeId}-${n}`,
      placeId,
      filename: `${n}.jpg`,
      mimeType: "image/jpeg",
      createdAt: "2026-10-01T00:00:00.000Z",
      source: "upload" as const,
    }));
  });
  const make = (placeId: string, classification: "SAME_PLACE" | "DIFFERENT_PLACE", score: number) => ({
    id: createMatchResultId(placeId, "p1"),
    placeId,
    imageRecordId: "p1",
    classification,
    matchedFeatures: classification === "SAME_PLACE" ? ["bench", "stone wall"] : [],
    score,
    reason: `${placeId} reason`,
    provider: "test",
    analysisVersion: 1,
    matchedAt: "2026-10-05T00:00:00.000Z",
    status: "pending" as const,
    previousEvaluations:
      placeId === "seating-area"
        ? [{ classification: "NEARBY_CONTEXT" as const, score: 0.4, reason: "old", provider: "test", analysisVersion: 1, matchedAt: "2026-10-01T00:00:00.000Z" }]
        : undefined,
  });
  training = upsertMatchResult(training, make("seating-area", "SAME_PLACE", 0.95));
  training = upsertMatchResult(training, make("raised-bed", "DIFFERENT_PLACE", 0.1));
  training = upsertMatchResult(training, make("house-wall", "DIFFERENT_PLACE", 0.1));

  return {
    training,
    visit: {
      id: "v",
      placeId: "courtyard",
      date: "2026-10-05",
      entries: [],
      imageRecords: [
        { id: "p1", filename: "one.jpg", fileSize: 1, format: "jpeg", sourcePath: "one.jpg", thumbnailUrl: "blob:one" },
        { id: "p2", filename: "two.jpg", fileSize: 1, format: "jpeg", sourcePath: "two.jpg", thumbnailUrl: "blob:two" },
      ],
    },
  };
}

describe("PlaceSortingQueue", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows persisted proposals and re-evaluation history on load without calling Vision", async () => {
    const { visit, training } = build();
    const derive = vi.fn();
    const match = vi.fn();
    const onAssign = vi.fn(() => null);

    await act(async () => {
      root.render(
        <PlaceSortingQueue
          visit={visit}
          training={training}
          getTraining={() => training}
          onTrainingChange={() => undefined}
          onAssign={onAssign}
          onSetAside={() => undefined}
          onReturnToQueue={() => undefined}
          visionProvider={{ id: "x", derivePlaceSignature: derive, matchPlaceCandidate: match } as unknown as VisionProvider}
        />
      );
    });

    expect(container.querySelector("[data-testid='sorting-status-p1']")?.textContent).toContain("Proposed primary place");
    expect(container.textContent).toContain("Previous: NEARBY_CONTEXT (40%)");
    expect(container.textContent).toContain("Matched: bench, stone wall");
    expect(container.querySelector("[data-testid='sorting-expected-calls']")?.textContent).toContain("model calls in total");
    expect(container.querySelector("[data-testid='sorting-item-p2']")).toBeNull();
    expect(derive).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector("[data-testid='sorting-approve-p1']") as HTMLButtonElement).click();
    });
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ imageRecordId: "p1" }), "seating-area");
    expect(derive).not.toHaveBeenCalled();
  });

  it("is collapsed by default with a visible summary, and flags registered anchors whose image data is missing", async () => {
    const { visit, training } = build();
    const before = JSON.stringify(training);

    await act(async () => {
      root.render(
        <PlaceSortingQueue
          visit={{ ...visit, imageRecords: [{ ...visit.imageRecords![0], placeId: "house-wall" }, visit.imageRecords![1]] }}
          training={training}
          getTraining={() => training}
          onTrainingChange={() => undefined}
          onAssign={() => null}
          onSetAside={() => undefined}
          onReturnToQueue={() => undefined}
          visionProvider={{ id: "x" } as unknown as VisionProvider}
        />
      );
    });

    const toggle = container.querySelector("[data-testid='sorting-toggle']") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("#sorting-queue-body")?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelector("[data-testid='sorting-summary']")?.textContent).toMatch(
      /in queue · 0 of \d+ places eligible for matching · \d+ expected model calls/
    );

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("#sorting-queue-body")?.hasAttribute("hidden")).toBe(false);

    const row = container.querySelector("[data-testid='readiness-seating-area']") as HTMLElement;
    expect(row.textContent).toContain("3");
    expect(row.textContent).toContain("Image data missing for 3");
    // Assigned photographs are reported separately from anchors.
    expect(container.querySelector("[data-testid='readiness-house-wall']")?.textContent).toContain("Image data missing");
    expect(container.querySelector("[data-testid='readiness-house-wall']")?.querySelectorAll("td")[2].textContent).toBe("1");
    expect(JSON.stringify(training)).toBe(before);
  });
});
