import { describe, expect, it } from "vitest";
import type { Entry, VisualAnalysisResult } from "../models/blomzip";
import { getEntryPrivacyStatus, isEntryPrivacyBlocked } from "./privacy";

function createEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "entry-1",
    imageRecordId: "image-1",
    visitId: "visit-1",
    status: "new",
    notes: "",
    tags: [],
    observations: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function visualAnalysis(signal: string, detail: string, confidence = 0.95): VisualAnalysisResult {
  return {
    signals: [{ signal: signal as VisualAnalysisResult["signals"][number]["signal"], confidence, detail, provider: "test", analysisVersion: 1 }],
    provider: "test",
    generatedAt: "2026-01-01T00:00:00.000Z",
    analysisVersion: 1,
  };
}

describe("privacy status", () => {
  it("keeps zero-confidence negative person and face detections clear", () => {
    const analysis = {
      ...visualAnalysis("person-detected", "No identifiable human present in the image.", 0),
      signals: [
        visualAnalysis("person-detected", "No identifiable human present in the image.", 0).signals[0],
        visualAnalysis("face-detected", "No human faces visible.", 0).signals[0],
      ],
    };

    expect(getEntryPrivacyStatus(createEntry({ privacyStatus: "review-required", visualAnalysis: analysis }))).toBe("clear");
    expect(isEntryPrivacyBlocked(createEntry({ visualAnalysis: analysis }))).toBe(false);
  });

  it("blocks positive person, face, and readable registration plate detections", () => {
    expect(isEntryPrivacyBlocked(createEntry({ visualAnalysis: visualAnalysis("person-detected", "Person detected", 0.99) }))).toBe(true);
    expect(isEntryPrivacyBlocked(createEntry({ visualAnalysis: visualAnalysis("face-detected", "Face detected", 0.6) }))).toBe(true);
    expect(isEntryPrivacyBlocked(createEntry({ visualAnalysis: visualAnalysis("face-detected", "An identifiable face is visible.") }))).toBe(true);
    expect(isEntryPrivacyBlocked(createEntry({ visualAnalysis: visualAnalysis("readable-registration-plate", "Plate detected", 0.4) }))).toBe(true);
  });

  it("leaves unaffected images clear and supports a persisted safe resolution", () => {
    expect(getEntryPrivacyStatus(createEntry())).toBe("clear");
    expect(getEntryPrivacyStatus(createEntry({ privacyStatus: "privacy-safe", visualAnalysis: visualAnalysis("face-detected", "A face is visible.") }))).toBe("privacy-safe");
    expect(isEntryPrivacyBlocked(createEntry({ privacyStatus: "privacy-safe" }))).toBe(false);
  });
});