import type { PlaceMatchResult } from "../models/blomzip";
import { parseCaptureDate } from "./captureDate";

export const MIN_PROPOSAL_PHOTOS = 4;
export const MAX_PROPOSAL_PHOTOS = 6;
export const MAX_PROPOSALS = 3;
export const SHORTLIST_SIZE = 4;
export const MIN_THEN_NOW_YEARS_APART = 2;
export const MIN_THEN_NOW_SHARED_FEATURES = 2;

/** Read-only input assembled from existing archive data. Nothing here is ever written back. */
export interface StoryDiscoveryPhoto {
  id: string;
  src: string;
  filename: string;
  alt: string;
  captureDate?: string;
  placeId?: string;
  placeLabel?: string;
  storySelected: boolean;
  hero: boolean;
  favorite: boolean;
  /** Highest existing Story/Hero/Favorite recommendation score (0–1), if any. Never recomputed here. */
  recommendationScore: number;
  /** Signals already stored by earlier, curator-triggered analysis (e.g. "human-activity"). */
  signals: string[];
  isExternal: boolean;
  isHidden: boolean;
  privacyBlocked: boolean;
}

export type StoryThemeKind = "place-over-time" | "seasons" | "highlights";

export interface RankedPhoto {
  photo: StoryDiscoveryPhoto;
  relevance: number;
  /** Factual reasons taken from stored data only. */
  reasons: string[];
}

export interface StoryProposal {
  id: string;
  kind: StoryThemeKind;
  title: string;
  /** Always a suggestion: the archive documents photographs, not events. */
  rationale: string;
  openingId: string;
  /** Suggested order: opening image first, then chronological. */
  sequence: RankedPhoto[];
  /** Small relevant shortlist for "Replace image". */
  shortlist: RankedPhoto[];
  score: number;
}

export interface ThenNowPair {
  before: StoryDiscoveryPhoto;
  after: StoryDiscoveryPhoto;
  sharedFeatures: string[];
  yearsApart: number;
}

function usable(photo: StoryDiscoveryPhoto): boolean {
  const src = photo.src.trim();
  return src !== "" && !src.startsWith("data:image/svg+xml") && !photo.isExternal && !photo.isHidden && !photo.privacyBlocked;
}

const POSITIVE_SIGNALS: Record<string, string> = {
  "human-activity": "shows human activity",
  "place-legibility": "the place is clearly legible",
  "visible-change-cue": "contains a visible change cue",
  "spatial-overview": "documents the spatial layout",
};

export function rankPhoto(photo: StoryDiscoveryPhoto): RankedPhoto {
  const reasons: string[] = [];
  let relevance = 0;

  reasons.push(photo.storySelected ? "Already selected for Story" : "New Story candidate");

  if (photo.hero) {
    relevance += 0.15;
    reasons.push("Marked as hero");
  }

  if (photo.favorite) {
    relevance += 0.08;
    reasons.push("Marked as favourite");
  }

  // recommendationScore combines several editorial recommendation types and is not
  // a calibrated Story confidence, so it must not rank Story Discovery candidates.

  const signalReasons = photo.signals.filter((signal) => POSITIVE_SIGNALS[signal]).map((signal) => POSITIVE_SIGNALS[signal]);

  if (signalReasons.length > 0) {
    relevance += 0.1 * Math.min(1, signalReasons.length / 2);
    reasons.push(`Stored analysis: ${signalReasons.join(", ")}`);
  }

  return { photo, relevance: Math.round(relevance * 1000) / 1000, reasons };
}

function time(photo: StoryDiscoveryPhoto): number {
  return parseCaptureDate(photo.captureDate)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function yearOf(photo: StoryDiscoveryPhoto): number | null {
  return parseCaptureDate(photo.captureDate)?.getFullYear() ?? null;
}

const SEASONS = ["winter", "spring", "summer", "autumn"] as const;

function seasonOf(photo: StoryDiscoveryPhoto): (typeof SEASONS)[number] | null {
  const date = parseCaptureDate(photo.captureDate);
  return date ? SEASONS[Math.floor(((date.getMonth() + 1) % 12) / 3)] : null;
}

function byRelevance(left: RankedPhoto, right: RankedPhoto): number {
  return right.relevance - left.relevance || time(left.photo) - time(right.photo) || left.photo.id.localeCompare(right.photo.id);
}

/** Best photograph of each group first (so the story covers the theme), then the best of the rest. */
function pickDiverse(ranked: RankedPhoto[], groupOf: (photo: StoryDiscoveryPhoto) => string | number | null): RankedPhoto[] {
  const sorted = [...ranked].sort(byRelevance);
  const picked: RankedPhoto[] = [];
  const seen = new Set<string | number>();

  for (const item of sorted) {
    const group = groupOf(item.photo);

    if (group !== null && !seen.has(group)) {
      seen.add(group);
      picked.push(item);
    }
  }

  const leftovers = sorted.filter((item) => !picked.includes(item));
  const strongest = picked.sort(byRelevance).slice(0, MAX_PROPOSAL_PHOTOS);

  return [...strongest, ...leftovers].slice(0, MAX_PROPOSAL_PHOTOS);
}

function orderSequence(picks: RankedPhoto[]): RankedPhoto[] {
  // A place-over-time proposal should read as a timeline, not open with whichever
  // image happens to have the highest mixed editorial score.
  return [...picks].sort((left, right) => time(left.photo) - time(right.photo) || left.photo.id.localeCompare(right.photo.id));
}

function finish(
  kind: StoryThemeKind,
  key: string,
  title: string,
  rationale: string,
  picks: RankedPhoto[],
  scope: RankedPhoto[]
): StoryProposal | null {
  if (picks.length < MIN_PROPOSAL_PHOTOS) {
    return null;
  }

  const chosen = new Set(picks.map((item) => item.photo.id));
  const sequence = orderSequence(picks);

  return {
    id: `${kind}:${key}`,
    kind,
    title,
    rationale,
    openingId: sequence[0].photo.id,
    sequence,
    shortlist: scope.filter((item) => !chosen.has(item.photo.id)).sort(byRelevance).slice(0, SHORTLIST_SIZE),
    score: Math.round(picks.reduce((total, item) => total + item.relevance, 0) * 1000) / 1000,
  };
}

const STORY_EVIDENCE_SIGNALS = new Set([
  "human-activity",
  "visible-change-cue",
  "spatial-overview",
  "place-legibility",
]);

function placeProposals(pool: RankedPhoto[], matchResults: readonly PlaceMatchResult[]): StoryProposal[] {
  const byPlace = new Map<string, RankedPhoto[]>();

  for (const item of pool) {
    if (item.photo.placeId && yearOf(item.photo) !== null) {
      byPlace.set(item.photo.placeId, [...(byPlace.get(item.photo.placeId) ?? []), item]);
    }
  }

  const proposals: StoryProposal[] = [];

  for (const [placeId, items] of byPlace) {
    const years = [...new Set(items.map((item) => yearOf(item.photo) as number))].sort((a, b) => a - b);
    const newItems = items.filter((item) => !item.photo.storySelected);
    const newYears = new Set(newItems.map((item) => yearOf(item.photo)).filter((year): year is number => year !== null));

    // Story selections can provide context, but a proposal must add at least two
    // unselected photographs across more than one year.
    if (years.length < 3 || newItems.length < 2 || newYears.size < 2) {
      continue;
    }

    const supportedPair = findThenNow(items.map((item) => item.photo), matchResults);
    const rankedById = new Map(items.map((item) => [item.photo.id, item]));
    const pairItems = supportedPair
      ? [rankedById.get(supportedPair.before.id), rankedById.get(supportedPair.after.id)]
          .filter((item): item is RankedPhoto => Boolean(item))
      : [];
    const newPicks = pickDiverse(newItems, (photo) => yearOf(photo));
    const selectedContext = pickDiverse(items.filter((item) => item.photo.storySelected), (photo) => yearOf(photo)).slice(0, 2);
    const orderedCandidates = [...pairItems, ...selectedContext, ...newPicks];
    const seen = new Set<string>();
    const picks = orderedCandidates.filter((item) => {
      if (seen.has(item.photo.id)) return false;
      seen.add(item.photo.id);
      return true;
    }).slice(0, MAX_PROPOSAL_PHOTOS);

    const pickedYears = new Set(picks.map((item) => yearOf(item.photo)).filter((year): year is number => year !== null));
    const newPhotosInPicks = picks.filter((item) => !item.photo.storySelected);
    const pickedNewYears = new Set(newPhotosInPicks.map((item) => yearOf(item.photo)).filter((year): year is number => year !== null));
    const hasStoryEvidence = picks.some((item) => item.photo.signals.some((signal) => STORY_EVIDENCE_SIGNALS.has(signal)));
    const verifiedPairInPicks = findThenNow(picks.map((item) => item.photo), matchResults);

    if (
      picks.length < MIN_PROPOSAL_PHOTOS ||
      newPhotosInPicks.length < 2 ||
      pickedNewYears.size < 2 ||
      pickedYears.size < 3 ||
      !hasStoryEvidence
    ) {
      continue;
    }

    const label = items[0].photo.placeLabel ?? placeId;
    const continuityNote = verifiedPairInPicks
      ? `A reviewed comparison links two years through ${verifiedPairInPicks.sharedFeatures.join(", ")}.`
      : "No reviewed photo-to-photo match links the years yet, so check the framing and fixed landmarks before treating this as a continuous sequence.";
    const proposal = finish(
      "place-over-time",
      placeId,
      `${label}, over the years`,
      `A candidate sequence for ${label}: ${newPhotosInPicks.length} new photographs across ${pickedNewYears.size} years, with existing Story selections shown only as context. ${continuityNote} A stored visual clue is present, but the photographs still need curator review to establish what changed.`,
      picks,
      items
    );

    if (proposal) {
      proposals.push({ ...proposal, score: proposal.score + pickedYears.size * 0.05 });
    }
  }

  return proposals;
}

/**
 * Uses existing Story selections as context, but every proposal must add new photographs.
 */
export function buildStoryProposals(
  photos: readonly StoryDiscoveryPhoto[],
  matchResults: readonly PlaceMatchResult[] = []
): StoryProposal[] {
  let pool = photos.filter(usable).map(rankPhoto);
  const proposals: StoryProposal[] = [];

  while (proposals.length < MAX_PROPOSALS) {
    const candidates = placeProposals(pool, matchResults).sort(
      (left, right) => right.score - left.score || left.id.localeCompare(right.id)
    );
    const best = candidates[0];

    if (!best) {
      break;
    }

    proposals.push(best);
    const used = new Set(best.sequence.map((item) => item.photo.id));
    pool = pool.filter((item) => !used.has(item.photo.id));
  }

  return proposals;
}

export interface StoryDiscoveryDiagnostics {
  datedPlaceGroups: number;
  groupsAcrossThreeYears: number;
  groupsWithNewPhotosAcrossYears: number;
  groupsMeetingPhotoAndYearCriteria: number;
  groupsWithFourPhotos: number;
  groupsWithStoredVisualClue: number;
}

/**
 * Summarizes why place groups may not reach a Story proposal.
 * Counts are based only on usable archive data already in memory; no analysis is run.
 */
export function getStoryDiscoveryDiagnostics(
  photos: readonly StoryDiscoveryPhoto[]
): StoryDiscoveryDiagnostics {
  const byPlace = new Map<string, StoryDiscoveryPhoto[]>();

  for (const photo of photos.filter(usable)) {
    if (photo.placeId && yearOf(photo) !== null) {
      byPlace.set(photo.placeId, [...(byPlace.get(photo.placeId) ?? []), photo]);
    }
  }

  const groups = [...byPlace.values()];
  const groupsAcrossThreeYears = groups.filter(
    (items) => new Set(items.map(yearOf).filter((year): year is number => year !== null)).size >= 3
  );
  const groupsWithNewPhotosAcrossYears = groups.filter((items) => {
    const newPhotos = items.filter((photo) => !photo.storySelected);
    return newPhotos.length >= 2 &&
      new Set(newPhotos.map(yearOf).filter((year): year is number => year !== null)).size >= 2;
  });
  const groupsMeetingPhotoAndYearCriteria = groups.filter((items) => {
    const years = new Set(items.map(yearOf).filter((year): year is number => year !== null));
    const newPhotos = items.filter((photo) => !photo.storySelected);
    const newYears = new Set(newPhotos.map(yearOf).filter((year): year is number => year !== null));
    return years.size >= 3 && newPhotos.length >= 2 && newYears.size >= 2;
  });
  const groupsWithFourPhotos = groupsMeetingPhotoAndYearCriteria.filter(
    (items) => items.length >= MIN_PROPOSAL_PHOTOS
  );
  const groupsWithStoredVisualClue = groupsWithFourPhotos.filter((items) =>
    items.some((photo) => photo.signals.some((signal) => STORY_EVIDENCE_SIGNALS.has(signal)))
  );

  return {
    datedPlaceGroups: groups.length,
    groupsAcrossThreeYears: groupsAcrossThreeYears.length,
    groupsWithNewPhotosAcrossYears: groupsWithNewPhotosAcrossYears.length,
    groupsMeetingPhotoAndYearCriteria: groupsMeetingPhotoAndYearCriteria.length,
    groupsWithFourPhotos: groupsWithFourPhotos.length,
    groupsWithStoredVisualClue: groupsWithStoredVisualClue.length,
  };
}

function normalizeFeature(value: string): string {
  return value.trim().toLowerCase();
}

function approvedFeatures(photoId: string, placeId: string, results: readonly PlaceMatchResult[]): Set<string> | null {
  const approved = results.filter(
    (result) =>
      result.imageRecordId === photoId &&
      result.placeId === placeId &&
      result.classification === "SAME_PLACE" &&
      result.status === "approved"
  );

  if (approved.length === 0) {
    return null;
  }

  return new Set(approved.flatMap((result) => result.matchedFeatures ?? []).map(normalizeFeature).filter(Boolean));
}

/**
 * A Then/Now pair needs more than the same Canonical Place: both photographs must carry a curator-approved
 * SAME_PLACE match for that place, share at least two matched fixed features, and be years apart.
 * Returns null when this cannot be established, so the comparison is simply omitted.
 */
export function findThenNow(photos: readonly StoryDiscoveryPhoto[], results: readonly PlaceMatchResult[]): ThenNowPair | null {
  const dated = photos.filter((photo) => photo.placeId && yearOf(photo) !== null).sort((a, b) => time(a) - time(b));
  let best: ThenNowPair | null = null;

  for (let i = 0; i < dated.length; i += 1) {
    for (let j = i + 1; j < dated.length; j += 1) {
      const before = dated[i];
      const after = dated[j];
      const yearsApart = (yearOf(after) as number) - (yearOf(before) as number);

      if (before.placeId !== after.placeId || yearsApart < MIN_THEN_NOW_YEARS_APART) {
        continue;
      }

      const left = approvedFeatures(before.id, before.placeId as string, results);
      const right = approvedFeatures(after.id, after.placeId as string, results);
      const shared = left && right ? [...left].filter((feature) => right.has(feature)) : [];

      if (shared.length >= MIN_THEN_NOW_SHARED_FEATURES && (!best || shared.length > best.sharedFeatures.length)) {
        best = { before, after, sharedFeatures: shared, yearsApart };
      }
    }
  }

  return best;
}
