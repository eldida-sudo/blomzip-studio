/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceMatchResult } from "../models/blomzip";
import type { StoryDiscoveryPhoto } from "../utils/storyDiscovery";
import { StoryDiscovery } from "./StoryDiscovery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function photo(id: string, year: number, extra: Partial<StoryDiscoveryPhoto> = {}): StoryDiscoveryPhoto {
  return {
    id,
    src: `blob:${id}`,
    filename: `${id}.jpg`,
    alt: id,
    captureDate: `${year}-06-15T12:00:00.000Z`,
    placeId: "rock",
    placeLabel: "Rock Garden",
    storySelected: false,
    hero: false,
    favorite: false,
    recommendationScore: 0,
    signals: [],
    isExternal: false,
    isHidden: false,
    privacyBlocked: false,
    ...extra,
  };
}

const photos = [2016, 2018, 2020, 2022, 2024, 2025, 2026].map((year, index) => photo(`p${year}`, year, { recommendationScore: 0.9 - index * 0.1 }));

function click(container: HTMLElement, testId: string) {
  act(() => {
    container.querySelector(`[data-testid="${testId}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("StoryDiscovery", () => {
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

  function render(matchResults: PlaceMatchResult[] = [], handlers: { onViewStory?: () => void; onClose?: () => void } = {}) {
    act(() => {
      root.render(<StoryDiscovery photos={photos} matchResults={matchResults} onViewStory={handlers.onViewStory ?? (() => undefined)} onClose={handlers.onClose ?? (() => undefined)} />);
    });
  }

  it("shows a limited draft proposal, not the whole archive, and approval is distinct from publishing", () => {
    render();

    const proposal = container.querySelector('[data-testid^="story-proposal-place-over-time"]') as HTMLElement;
    const id = proposal.getAttribute("data-testid")?.replace("story-proposal-", "") as string;

    expect(container.querySelectorAll("figure").length).toBeLessThanOrEqual(7);
    expect(container.querySelector(`[data-testid="story-proposal-status-${id}"]`)?.textContent).toBe("Draft proposal");

    click(container, `story-approve-${id}`);

    const status = container.querySelector(`[data-testid="story-proposal-status-${id}"]`)?.textContent;
    expect(status).toContain("Approved");
    expect(status).toContain("not published");
    expect(container.querySelector('[data-testid="story-discovery-guard"]')?.textContent).toContain("does not publish");
  });

  it("skips a proposal and hides its photographs", () => {
    render();
    const id = (container.querySelector('[data-testid^="story-proposal-place-over-time"]') as HTMLElement).getAttribute("data-testid")!.replace("story-proposal-", "");

    click(container, `story-skip-${id}`);

    expect(container.querySelector(`[data-testid="story-proposal-status-${id}"]`)?.textContent).toBe("Skipped");
    expect(container.querySelectorAll("figure").length).toBe(0);
  });

  it("replaces an image from the shortlist only", () => {
    render();
    const before = Array.from(container.querySelectorAll('[data-testid^="story-photo-"]')).map((el) => el.getAttribute("data-testid"));

    act(() => {
      (container.querySelector(".story-discovery-cell .story-discovery-link") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const options = Array.from(container.querySelectorAll('[data-testid^="story-replace-with-"]'));
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(4);

    const chosen = options[0].getAttribute("data-testid")!.replace("story-replace-with-", "");
    act(() => {
      options[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const after = Array.from(container.querySelectorAll('[data-testid^="story-photo-"]')).map((el) => el.getAttribute("data-testid"));
    expect(after).toContain(`story-photo-${chosen}`);
    expect(after.length).toBe(before.length);
  });

  it("shows Then/Now only with strong correspondence and omits it for the same place alone", () => {
    render();
    expect(container.querySelector('[data-testid^="story-thennow-"]')).toBeNull();

    const strong = (id: string): PlaceMatchResult => ({
      id, placeId: "rock", imageRecordId: id, classification: "SAME_PLACE", matchedFeatures: ["lattice screen", "stone step"],
      score: 0.9, reason: "", provider: "t", analysisVersion: 1, matchedAt: "2026-10-01T00:00:00.000Z", status: "approved",
    });

    render(photos.map((p) => strong(p.id)));
    expect(container.querySelector('[data-testid^="story-thennow-"]')?.textContent).toContain("lattice screen, stone step");
  });

  it("offers navigation to the existing Story and an honest empty state", () => {
    const onViewStory = vi.fn();
    render([], { onViewStory });
    click(container, "story-discovery-view-story");
    expect(onViewStory).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(<StoryDiscovery photos={[]} matchResults={[]} onViewStory={() => undefined} onClose={() => undefined} />);
    });
    expect(container.querySelector('[data-testid="story-discovery-empty"]')).not.toBeNull();
  });
});
