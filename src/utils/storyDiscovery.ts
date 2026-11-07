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

  if (photo.storySelected) {
    relevance += 0.3;
    reasons.push("Already selected for Story");
  }

  if (photo.hero) {
    relevance += 0.15;
    reasons.push("Marked as hero");
  }

  if (photo.favorite) {
    relevance += 0.08;
    reasons.push("Marked as favourite");
  }

  if (photo.recommendationScore > 0) {
    relevance += 0.25 * Math.min(photo.recommendationScore, 1);
    reasons.push(`Recommended by existing analysis (${Math.round(photo.recommendationScore * 100)}%)`);
  }

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
  const opening = [...picks].sort(byRelevance)[0];
  const rest = picks.filter((item) => item !== opening).sort((left, right) => time(left.photo) - time(right.photo) || left.photo.id.localeCompare(right.photo.id));

  return [opening, ...rest];
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

function placeProposals(pool: RankedPhoto[]): StoryProposal[] {
  const byPlace = new Map<string, RankedPhoto[]>();

  for (const item of pool) {
    if (item.photo.placeId && yearOf(item.photo) !== null) {
      byPlace.set(item.photo.placeId, [...(byPlace.get(item.photo.placeId) ?? []), item]);
    }
  }

  const proposals: StoryProposal[] = [];

  for (const [placeId, items] of byPlace) {
    const years = [...new Set(items.map((item) => yearOf(item.photo) as number))].sort((a, b) => a - b);

    if (years.length < 3) {
      continue;
    }

    const picks = pickDiverse(items, (photo) => yearOf(photo));
    const label = items[0].photo.placeLabel ?? placeId;
    const proposal = finish(
      "place-over-time",
      placeId,
      `${label}, over the years`,
      `Photographs of ${label} taken in ${years.length} different years, from ${years[0]} to ${years[years.length - 1]}. ` +
        "Suggested theme: the archive shows what was photographed, not what changed in between.",
      picks,
      items
    );

    if (proposal) {
      proposals.push({ ...proposal, score: proposal.score + years.length * 0.05 });
    }
  }

  return proposals;
}

function seasonProposals(pool: RankedPhoto[]): StoryProposal[] {
  const byYear = new Map<number, RankedPhoto[]>();

  for (const item of pool) {
    const year = yearOf(item.photo);

    if (year !== null) {
      byYear.set(year, [...(byYear.get(year) ?? []), item]);
    }
  }

  const proposals: StoryProposal[] = [];

  for (const [year, items] of byYear) {
    const seasons = new Set(items.map((item) => seasonOf(item.photo)));

    if (seasons.size < 3) {
      continue;
    }

    const proposal = finish(
      "seasons",
      String(year),
      `${year}, season by season`,
      `Photographs from ${year} spanning ${seasons.size} seasons (by capture date). Suggested theme: seasons are inferred from dates only.`,
      pickDiverse(items, seasonOf),
      items
    );

    if (proposal) {
      proposals.push({ ...proposal, score: proposal.score + seasons.size * 0.05 });
    }
  }

  return proposals;
}

function highlightProposals(pool: RankedPhoto[]): StoryProposal[] {
  const strong = pool.filter((item) => item.relevance >= 0.25);
  const proposal = finish(
    "highlights",
    "all",
    "The strongest photographs",
    "The photographs the archive already marks or recommends most strongly for Story. Suggested selection: ordering and framing are for the curator to decide.",
    pickDiverse(strong, (photo) => yearOf(photo)),
    strong
  );

  return proposal ? [proposal] : [];
}

/**
 * Up to three distinct, data-grounded story proposals. Reuses stored recommendations and curator decisions;
 * makes no model calls. A photograph appears in at most one proposal.
 */
export function buildStoryProposals(photos: readonly StoryDiscoveryPhoto[]): StoryProposal[] {
  let pool = photos.filter(usable).map(rankPhoto);
  const proposals: StoryProposal[] = [];

  while (proposals.length < MAX_PROPOSALS) {
    const candidates = [...placeProposals(pool), ...seasonProposals(pool), ...highlightProposals(pool)].sort(
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
