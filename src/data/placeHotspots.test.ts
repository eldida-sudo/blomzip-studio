/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLACE_HOTSPOT_CALIBRATION_STORAGE_KEY } from "./placeHotspots";

describe("place hotspot calibration persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function loadHotspots() {
    return import("./placeHotspots");
  }

  it("writes a calibration override and restores it after a module reload", async () => {
    const firstLoad = await loadHotspots();

    firstLoad.calibratePlaceHotspot("parking", { x: 0.22, y: 0.44 });

    expect(localStorage.getItem(PLACE_HOTSPOT_CALIBRATION_STORAGE_KEY)).toContain('"parking"');
    expect(firstLoad.getPlaceHotspot("parking")).toMatchObject({ x: 0.22, y: 0.44, calibrated: true });

    vi.resetModules();
    const reloaded = await loadHotspots();
    expect(reloaded.getPlaceHotspot("parking")).toMatchObject({ x: 0.22, y: 0.44, calibrated: true });
  });

  it("overwrites the persisted coordinate during recalibration", async () => {
    const hotspots = await loadHotspots();

    hotspots.calibratePlaceHotspot("parking", { x: 0.22, y: 0.44 });
    hotspots.calibratePlaceHotspot("parking", { x: 0.77, y: 0.88 });

    vi.resetModules();
    const reloaded = await loadHotspots();
    expect(reloaded.getPlaceHotspot("parking")).toMatchObject({ x: 0.77, y: 0.88, calibrated: true });
  });

  it("keeps baseline uncalibrated places uncalibrated without an override", async () => {
    const hotspots = await loadHotspots();

    expect(hotspots.getPlaceHotspot("parking")).toMatchObject({ x: 0.15, y: 0.3, calibrated: false });
  });
});