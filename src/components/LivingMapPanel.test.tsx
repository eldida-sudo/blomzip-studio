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
});