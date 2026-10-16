/**
 * @vitest-environment jsdom
 */

import { useRef, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlaceById } from "../data/canonicalPlaces";
import type { PlaceTrainingState, Visit } from "../models/blomzip";
import {
  approveMatch,
  createEmptyPlaceTrainingState,
  createMatchResultId,
  markMatchUnsure,
  reassignMatch,
  selectMatchCandidates,
  undoReview,
  upsertMatchResult,
} from "../utils/placeTraining";
import type { VisionProvider } from "../utils/visionProvider";
import { PlaceTrainingPanel } from "./PlaceTrainingPanel";

const place = getPlaceById("seating-area") as NonNullable<ReturnType<typeof getPlaceById>>;

const initialVisit: Visit = {
  id: "visit-1",
  placeId: "courtyard",
  date: "2026-10-05",
  entries: [],
  imageRecords: [
    { id: "img-1", filename: "one.jpg", fileSize: 1, format: "jpeg", sourcePath: "one.jpg", thumbnailUrl: "blob:one" },
  ],
};

const initialTraining: PlaceTrainingState = upsertMatchResult(createEmptyPlaceTrainingState(), {
  id: createMatchResultId("seating-area", "img-1"),
  placeId: "seating-area",
  imageRecordId: "img-1",
  classification: "SAME_PLACE",
  score: 0.85,
  reason: "Same bench.",
  provider: "test",
  analysisVersion: 1,
  matchedAt: "2026-10-05T00:00:00.000Z",
  status: "pending",
});

let latest: { visit: Visit; training: PlaceTrainingState };

function Harness() {
  const [visit, setVisit] = useState(initialVisit);
  const [training, setTraining] = useState(initialTraining);
  const visitRef = useRef(visit);
  const trainingRef = useRef(training);
  latest = { visit, training };

  function apply(outcome: { ok: true; visit: Visit; state: PlaceTrainingState } | { ok: false; error: string }) {
    if (!outcome.ok) return outcome.error;
    visitRef.current = outcome.visit;
    trainingRef.current = outcome.state;
    setVisit(outcome.visit);
    setTraining(outcome.state);
    return null;
  }

  return (
    <PlaceTrainingPanel
      place={place}
      visit={visit}
      training={training}
      getTraining={() => trainingRef.current}
      onTrainingChange={(updater) => {
        trainingRef.current = updater(trainingRef.current);
        setTraining(trainingRef.current);
      }}
      onApproveMatch={(id) => apply(approveMatch(visitRef.current, trainingRef.current, id))}
      onReassignMatch={(id, target) => apply(reassignMatch(visitRef.current, trainingRef.current, id, target))}
      onMarkUnsure={(id) => {
        trainingRef.current = markMatchUnsure(trainingRef.current, id);
        setTraining(trainingRef.current);
      }}
      onUndoReview={(id) => apply(undoReview(visitRef.current, trainingRef.current, id))}
      visionProvider={{} as VisionProvider}
    />
  );
}

describe("PlaceTrainingPanel review actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const button = (text: string) =>
    Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);

  it("offers three actions and excludes the current place from the select", () => {
    expect(button("Approve suggested place")).toBeTruthy();
    expect(button("Not sure")).toBeTruthy();
    const select = container.querySelector("select[aria-label='Assign another place']") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain("raised-bed");
    expect(values).not.toContain("seating-area");
  });

  it("shows the safe existing-match re-evaluation action and candidate count", () => {
    const action = container.querySelector("[data-testid='reevaluate-place-matches']") as HTMLButtonElement;
    expect(action.textContent).toContain("Re-evaluate matches (1)");
    expect(action.disabled).toBe(true);
    expect(container.querySelector("[data-testid='reevaluation-candidate-count']")?.textContent).toContain(
      "1 existing unreviewed match eligible"
    );
  });

  it("assigns another place and Undo restores the photograph and the suggestion", () => {
    const select = container.querySelector("select[aria-label='Assign another place']") as HTMLSelectElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "raised-bed");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(latest.visit.imageRecords?.[0].placeId).toBe("raised-bed");
    expect(container.querySelector("[data-testid='place-match-list']")).toBeNull();

    act(() => button("Undo")?.click());

    expect(latest.visit.imageRecords?.[0].placeId).toBeUndefined();
    expect(latest.training.matchResults[0].status).toBe("pending");
    expect(latest.training.matchResults[0].review).toBeUndefined();
    expect(container.querySelector("[data-testid='place-match-img-1']")).toBeTruthy();
  });

  it("'Not sure' hides the card, keeps the photograph unassigned and eligible for other places", () => {
    act(() => button("Not sure")?.click());

    expect(container.querySelector("[data-testid='place-match-img-1']")).toBeNull();
    expect(latest.visit.imageRecords?.[0].placeId).toBeUndefined();
    expect(latest.training.matchResults[0].status).toBe("pending");
    expect(selectMatchCandidates(latest.visit, "raised-bed", latest.training)).toHaveLength(1);

    act(() => button("Undo")?.click());
    expect(container.querySelector("[data-testid='place-match-img-1']")).toBeTruthy();
  });

  it("opens a likely-match photograph preview without changing review state", () => {
    const trigger = container.querySelector("[data-testid='place-match-img-1'] .image-preview-trigger") as HTMLButtonElement;
    expect(trigger.getAttribute("aria-label")).toBe("Preview larger: one.jpg");
    const before = latest.training;

    act(() => trigger.click());

    expect(container.querySelector("[data-testid='image-preview-filename']")?.textContent).toBe("one.jpg");
    expect(container.querySelector("[data-testid='image-preview-image']")?.getAttribute("src")).toBe("blob:one");
    expect(latest.training).toBe(before);

    act(() => (container.querySelector(".image-preview-close") as HTMLButtonElement).click());
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(container.querySelector("[data-testid='place-match-img-1']")).toBeTruthy();
  });

  it("opens the archive picker with nothing pre-selected and no confirmation possible", () => {
    const open = container.querySelector("[data-testid='select-archive-anchors']") as HTMLButtonElement;
    act(() => open.click());
    const picker = container.querySelector("[data-testid='archive-anchor-picker']");
    expect(picker).toBeTruthy();
    expect(picker?.textContent).toContain("not proof");
    expect(container.querySelector("[data-testid='archive-anchor-candidate-img-1']")).toBeNull();
    expect((container.querySelector("[data-testid='confirm-archive-anchors']") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("PlaceTrainingPanel with External / Inspiration photographs", () => {
  it("hides stale suggestions and counts no candidates for an external photograph, without any provider call", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const externalVisit: Visit = {
      ...initialVisit,
      imageRecords: (initialVisit.imageRecords ?? []).map((record) => ({
        ...record,
        externalClassification: { classifiedAt: "2026-10-16T10:00:00.000Z" },
      })),
    };
    const provider = { matchPlaceCandidate: vi.fn(), derivePlaceSignature: vi.fn() } as unknown as VisionProvider;

    act(() =>
      root.render(
        <PlaceTrainingPanel
          place={place}
          visit={externalVisit}
          training={initialTraining}
          getTraining={() => initialTraining}
          onTrainingChange={() => undefined}
          onApproveMatch={() => null}
          onReassignMatch={() => null}
          onMarkUnsure={() => undefined}
          onUndoReview={() => null}
          visionProvider={provider}
        />
      )
    );

    expect(container.textContent).not.toContain("Approve suggested place");
    expect(container.querySelector("[data-testid='place-match-list']")).toBeNull();
    expect(container.querySelector("[data-testid='reevaluate-place-matches']")?.textContent).toContain("Re-evaluate matches (0)");
    expect(selectMatchCandidates(externalVisit, "seating-area", createEmptyPlaceTrainingState())).toEqual([]);
    expect(provider.matchPlaceCandidate).not.toHaveBeenCalled();
    expect(provider.derivePlaceSignature).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
