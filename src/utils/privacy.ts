import type { Entry, VisualAnalysisResult } from "../models/blomzip";

const PRIVACY_SIGNAL_IDS = new Set([
  "person-detected",
  "face-detected",
  "readable-registration-plate",
]);

export function visualAnalysisRequiresPrivacyReview(visualAnalysis: VisualAnalysisResult | undefined): boolean {
  return Boolean(visualAnalysis?.signals.some((signal) =>
    PRIVACY_SIGNAL_IDS.has(signal.signal) && signal.confidence > 0
  ));
}

export function getEntryPrivacyStatus(entry: Entry): "clear" | "review-required" | "privacy-safe" {
  if (entry.privacyStatus === "privacy-safe") return "privacy-safe";
  if (entry.visualAnalysis) {
    return visualAnalysisRequiresPrivacyReview(entry.visualAnalysis) ? "review-required" : "clear";
  }
  if (entry.privacyStatus === "review-required") {
    return "review-required";
  }

  return "clear";
}

export function isEntryPrivacyBlocked(entry: Entry): boolean {
  return getEntryPrivacyStatus(entry) === "review-required";
}