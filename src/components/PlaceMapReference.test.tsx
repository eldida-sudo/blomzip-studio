/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceMapReference } from "./PlaceMapReference";

describe("PlaceMapReference calibration", () => {
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

  function renderMap(placeId = "garden-border") {
    act(() => {
      root.render(<PlaceMapReference selectedPlaceId={placeId} />);
    });

    const map = container.querySelector(".place-map-svg") as SVGSVGElement;
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500,
      toJSON: () => ({}),
    });
    return map;
  }

  it("creates a pending coordinate when the map is clicked", () => {
    const map = renderMap();

    act(() => {
      map.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 250, clientY: 125 }));
    });

    expect(container.querySelector("[data-testid='calibration-coordinates']")?.textContent).toContain(
      "Logged: x: 0.25, y: 0.25"
    );
    expect(container.querySelector("[data-testid='pending-hotspot']")).toBeTruthy();
  });

  it("makes the hotspot appear after saving its position", () => {
    const map = renderMap();

    act(() => {
      map.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 400, clientY: 200 }));
    });
    act(() => {
      (container.querySelector("[data-testid='save-hotspot-position']") as HTMLButtonElement).click();
    });

    const hotspot = container.querySelector(".place-map-hotspot-active");
    expect(hotspot).toBeTruthy();
    expect(hotspot?.getAttribute("cx")).toBe("0.4");
    expect(hotspot?.getAttribute("cy")).toBe("0.4");
  });

  it("recalibration replaces the previous coordinate", () => {
    const map = renderMap("central-lawn");

    act(() => {
      map.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 50 }));
    });
    act(() => {
      (container.querySelector("[data-testid='save-hotspot-position']") as HTMLButtonElement).click();
    });
    act(() => {
      map.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 800, clientY: 350 }));
    });
    act(() => {
      (container.querySelector("[data-testid='save-hotspot-position']") as HTMLButtonElement).click();
    });

    const hotspot = container.querySelector(".place-map-hotspot-active");
    expect(hotspot?.getAttribute("cx")).toBe("0.8");
    expect(hotspot?.getAttribute("cy")).toBe("0.7");
  });
});