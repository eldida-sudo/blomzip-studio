/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LivingMapPanel } from "./LivingMapPanel";

describe("LivingMapPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<LivingMapPanel />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the full map without cropping and keeps calibrated hotspots normalized", () => {
    const map = container.querySelector(".living-map-banner-svg") as SVGSVGElement;
    const image = map.querySelector("image");
    const rockGardenHotspot = container.querySelector("[data-testid='living-map-hotspot-rock-garden']");

    expect(map.getAttribute("viewBox")).toBe("0 0 1934 1304");
    expect(map.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(image?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(container.querySelector("[data-testid='living-map-hotspot-parking']")).toBeNull();
    expect(Number(rockGardenHotspot?.getAttribute("cx"))).toBeCloseTo(0.3 * 1934);
    expect(Number(rockGardenHotspot?.getAttribute("cy"))).toBeCloseTo(0.4 * 1304);
    expect(Number(rockGardenHotspot?.getAttribute("r"))).toBeCloseTo(0.06 * 1934 * 0.33);
  });

  it("opens the enlarged map from the visible control", () => {
    act(() => {
      (container.querySelector("[data-testid='living-map-open-full']") as HTMLButtonElement).click();
    });

    expect(container.querySelector(".place-map-overlay")).toBeTruthy();
    expect(container.querySelector(".place-map-svg image")?.getAttribute("href")).toBe("/images/living-map.png");
  });

  it("offers an Unassigned option and place counts when counts are provided", () => {
    const selected: Array<string | null> = [];
    act(() =>
      root.render(
        <LivingMapPanel
          onPlaceSelect={(placeId) => selected.push(placeId)}
          placeCounts={{ total: 5, unassigned: 3, byPlace: { "rock-garden": 2 } }}
        />
      )
    );

    expect(container.querySelector("[data-testid='living-map-place-all']")?.textContent).toBe("All places (5)");
    expect(container.querySelector("[data-testid='living-map-place-rock-garden']")?.textContent).toContain("(2)");

    const unassigned = container.querySelector("[data-testid='living-map-place-unassigned']") as HTMLButtonElement;
    expect(unassigned.textContent).toBe("Unassigned (3)");

    act(() => unassigned.click());
    expect(selected).toEqual(["__unassigned__"]);
    expect(unassigned.className).toContain("is-active");
  });

  it("omits the Unassigned option when no counts are provided", () => {
    expect(container.querySelector("[data-testid='living-map-place-unassigned']")).toBeNull();
  });
});
