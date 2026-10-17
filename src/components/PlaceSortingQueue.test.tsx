/**
 * @vitest-environment jsdom
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

function noop() {}

function multi(): { visit: Visit; training: PlaceTrainingState } {
  const { visit, training } = build();
  let next = training;
  const same = (placeId: string, id: string, score: number) => ({
    id: createMatchResultId(placeId, id),
    placeId,
    imageRecordId: id,
    classification: "SAME_PLACE" as const,
    matchedFeatures: ["bench", "stone wall"],
    score,
    reason: "r",
    provider: "test",
    analysisVersion: 1,
    matchedAt: "2026-10-05T00:00:00.000Z",
    status: "pending" as const,
  });
  next = upsertMatchResult(next, same("seating-area", "p2", 0.9));
  next = upsertMatchResult(next, same("seating-area", "p3", 0.88));
  next = upsertMatchResult(next, same("raised-bed", "p3", 0.84));
  return {
    training: next,
    visit: {
      ...visit,
      imageRecords: [
        ...visit.imageRecords!,
        { id: "p3", filename: "three.jpg", fileSize: 1, format: "jpeg", sourcePath: "three.jpg", thumbnailUrl: "blob:three" },
        { id: "p4", filename: "four.jpg", fileSize: 1, format: "jpeg", sourcePath: "four.jpg", thumbnailUrl: "blob:four", overviewClassification: { classifiedAt: "2026-10-01T00:00:00.000Z" } },
      ],
    },
  };
}

describe("PlaceSortingQueue", () => {
  let container: HTMLDivElement;
  let root: Root;
  const derive = vi.fn();
  const match = vi.fn();
  const provider = { id: "x", derivePlaceSignature: derive, matchPlaceCandidate: match } as unknown as VisionProvider;

  beforeEach(() => {
    derive.mockClear();
    match.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(
    data: { visit: Visit; training: PlaceTrainingState },
    handlers: Partial<{ onAssign: () => string | null; onBulkAssign: () => { assigned: number; skipped: never[] }; onSetAside: () => void }> = {}
  ) {
    await act(async () => {
      root.render(
        <PlaceSortingQueue
          visit={data.visit}
          training={data.training}
          getTraining={() => data.training}
          onTrainingChange={noop}
          onAssign={handlers.onAssign ?? (() => null)}
          onBulkAssign={handlers.onBulkAssign ?? (() => ({ assigned: 0, skipped: [] }))}
          onSetAside={handlers.onSetAside ?? noop}
          onReturnToQueue={noop}
          visionProvider={provider}
        />
      );
    });
  }

  const q = (id: string) => container.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
  const click = (id: string) => act(() => (q(id) as HTMLButtonElement).click());

  it("shows persisted proposals without provider calls and approves from the gallery", async () => {
    const data = build();
    const before = JSON.stringify(data.training);
    const onAssign = vi.fn(() => null);
    await render(data, { onAssign });

    expect(q("sorting-conclusion-p1")?.textContent).toContain("Reliable suggestion: ");
    expect(q("sorting-item-p2")).toBeNull();
    expect(q("sorting-expected-calls")?.textContent).toContain("model calls in total");
    expect(q("sorting-toggle")?.getAttribute("aria-expanded")).toBe("true");

    await click("sorting-approve-p1");
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ imageRecordId: "p1" }), "seating-area");
    expect(derive).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
    expect(JSON.stringify(data.training)).toBe(before);
  });

  it("keeps heavy sections collapsed and reopenable, and flags missing anchor image data", async () => {
    const data = build();
    await render({ ...data, visit: { ...data.visit, imageRecords: [{ ...data.visit.imageRecords![0], placeId: "house-wall" }, data.visit.imageRecords![1]] } });

    const readiness = q("training-readiness") as HTMLDetailsElement;
    expect(readiness.open).toBe(false);
    expect((q("sorting-compare") as HTMLDetailsElement).open).toBe(false);
    act(() => {
      readiness.open = true;
    });
    expect(readiness.open).toBe(true);
    expect(q("readiness-seating-area")?.textContent).toContain("Image data missing for 3");
    expect(q("readiness-house-wall")?.querySelectorAll("td")[2].textContent).toBe("1");
  });

  it("shows progress counters that separate sorting from analysis", async () => {
    await render(multi());
    const items = [...container.querySelectorAll("[data-testid='sorting-progress'] .sorting-progress-item")].map((item) => [
      item.querySelector("dt")?.textContent,
      item.querySelector("dd")?.textContent,
    ]);
    expect(items).toHaveLength(8);
    expect(items).toContainEqual(["photographs in archive", "4"]);
    expect(items).toContainEqual(["assigned to a Canonical Place", "0"]);
    expect(items).toContainEqual(["awaiting a primary-place decision", "3"]);
    expect(items).toContainEqual(["Courtyard Overview", "1"]);
    expect(container.querySelector("[data-testid='sorting-progress'] li")).toBeNull();
  });

  it("renders cards in a dedicated grid with contained content and no inline layout", async () => {
    const data = multi();
    data.visit.imageRecords![0].filename = "a-very-long-filename-".repeat(8) + ".jpg";
    await render(data);

    const gallery = container.querySelector(".sorting-gallery") as HTMLElement;
    expect(gallery).toBeTruthy();
    const cards = [...gallery.children] as HTMLElement[];
    expect(cards.length).toBe(3);
    cards.forEach((card) => {
      expect(card.classList.contains("sorting-card")).toBe(true);
      expect(card.classList.contains("place-match-item")).toBe(false);
      expect(card.querySelector(".image-preview-trigger img")).toBeTruthy();
      expect(card.querySelector(".sorting-filename")).toBeTruthy();
      expect(card.querySelector("[data-testid^='sorting-conclusion-']")).toBeTruthy();
      expect(card.querySelector("[data-testid^='sorting-review-']")).toBeTruthy();
    });
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.querySelector(".sorting-filename")?.getAttribute("title")).toContain("a-very-long-filename-");
  });

  it("keeps focused review available and reachable from a card", async () => {
    await render(multi());
    await click("sorting-review-p2");
    expect(q("sorting-focus-filename")?.textContent).toBe("two.jpg");
    expect(container.querySelector(".sorting-gallery")).toBeNull();
    await click("sorting-view-toggle");
    expect(container.querySelector(".sorting-gallery")).toBeTruthy();
  });

  it("keeps heavy panels collapsed by default", async () => {
    await render(multi());
    for (const id of ["training-readiness", "sorting-compare"]) {
      expect((q(id) as HTMLDetailsElement).open).toBe(false);
    }
  });

  it("ships responsive grid and containment CSS for the queue", () => {
    const css = readFileSync(resolve(__dirname, "../App.css"), "utf8");
    expect(css).toMatch(/\.place-sorting-queue \.sorting-gallery\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(min\(100%, 280px\), 1fr\)\)/);
    expect(css).toMatch(/\.place-sorting-queue \.sorting-card img[^{]*\{[^}]*aspect-ratio:\s*4 \/ 3/);
    expect(css).toMatch(/\.sorting-card[^{]*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.sorting-filename[^{]*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.sorting-progress\s*\{[^}]*grid-template-columns/);
  });

  it("navigates focused review, shows analysis on demand, skips, assigns manually and sets aside", async () => {
    const onAssign = vi.fn(() => null);
    const onSetAside = vi.fn();
    await render(multi(), { onAssign, onSetAside });

    await click("sorting-view-toggle");
    expect(q("sorting-focus-position")?.textContent).toContain("1 of 3");
    expect(q("sorting-focus-filename")?.textContent).toBe("one.jpg");
    expect((q("sorting-prev") as HTMLButtonElement).disabled).toBe(true);

    const analysis = q("sorting-analysis") as HTMLDetailsElement;
    expect(analysis.open).toBe(false);
    expect(analysis.textContent).toContain("not calibrated probabilities");
    act(() => {
      analysis.open = true;
    });
    expect(analysis.open).toBe(true);
    expect(analysis.textContent).toContain("Previous: NEARBY_CONTEXT (40%)");

    await click("sorting-focus-skip");
    expect(q("sorting-focus-filename")?.textContent).toBe("two.jpg");
    await click("sorting-next");
    expect(q("sorting-focus-conclusion")?.textContent).toContain("Ambiguous: could be");
    expect(q("sorting-focus-approve")).toBeNull();
    await click("sorting-prev");
    expect(q("sorting-focus-filename")?.textContent).toBe("two.jpg");

    const select = q("sorting-focus-select") as HTMLSelectElement;
    await act(async () => {
      select.value = "house-wall";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ imageRecordId: "p2" }), "house-wall");

    await click("sorting-focus-unsure");
    expect(onSetAside).toHaveBeenCalledWith(expect.objectContaining({ imageRecordId: "p2" }));
    expect(derive).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
  });

  it("groups by likely place with ambiguous separated, and confirms bulk approval explicitly", async () => {
    const onBulkAssign = vi.fn(() => ({ assigned: 2, skipped: [] }));
    await render(multi(), { onBulkAssign });

    await act(async () => {
      const select = q("sorting-order") as HTMLSelectElement;
      select.value = "grouped";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(q("sorting-group-place:seating-area")?.textContent).toContain("one.jpg");
    expect(q("sorting-group-place:seating-area")?.textContent).toContain("two.jpg");
    expect(q("sorting-group-ambiguous")?.textContent).toContain("three.jpg");
    expect(q("sorting-group-ambiguous")?.textContent).not.toContain("Approve several");

    await click("sorting-bulk-open-place:seating-area");
    expect(onBulkAssign).not.toHaveBeenCalled();
    expect(q("sorting-bulk-preview")?.textContent).toContain("existing assignments are never changed");
    expect(q("sorting-bulk-confirm")?.textContent).toContain("assign 2 photographs to");

    await click("sorting-bulk-confirm");
    expect(onBulkAssign).toHaveBeenCalledWith(
      [expect.objectContaining({ imageRecordId: "p1" }), expect.objectContaining({ imageRecordId: "p2" })],
      "seating-area"
    );
  });
});
