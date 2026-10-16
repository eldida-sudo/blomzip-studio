import type { ImageRecord, PlaceTrainingState, Visit } from "../models/blomzip";
import { getPlaceById } from "../data/canonicalPlaces";
import { isRecordEligibleNow } from "./externalClassification";
import { planSortingRun, listSortablePlaceIds, type SortingRunPlan } from "./placeSorting";
import {
  computeAnchorSetKey,
  getCachedSignature,
  hashBlobContent,
  resolvePlaceSignature,
  type BlobHasher,
} from "./placeSignatureCache";
import { blobToDataUrl } from "./analysisImage";
import { createMatchResultId, getPlaceAnchors, upsertMatchResult } from "./placeTraining";
import type { VisionProvider } from "./visionProvider";

export interface SortingAnchorImages {
  get(anchorId: string): { blob: Blob } | undefined;
  has(anchorId: string): boolean;
}

export interface SortingReadiness {
  sortablePlaceIds: string[];
  plan: SortingRunPlan;
  /** Places in the plan whose signature is missing or stale and would cost one extra model call each. */
  uncachedSignaturePlaceIds: string[];
}

/** Everything the curator sees before starting a run. Makes no model calls. */
export async function computeSortingReadiness(
  visit: Visit | null,
  training: PlaceTrainingState,
  anchorImages: SortingAnchorImages,
  hash: BlobHasher = hashBlobContent
): Promise<SortingReadiness> {
  const available = new Set(
    Object.values(training.anchorsByPlaceId).flatMap((anchors) =>
      anchors.filter((anchor) => anchorImages.has(anchor.id)).map((anchor) => anchor.id)
    )
  );
  const sortablePlaceIds = listSortablePlaceIds(training, available);
  const plan = planSortingRun(visit, training, sortablePlaceIds);
  const neededPlaceIds = [...new Set(plan.items.flatMap((item) => item.placeIds))];
  const uncachedSignaturePlaceIds: string[] = [];

  for (const placeId of neededPlaceIds) {
    const anchors = getPlaceAnchors(training, placeId)
      .filter((anchor) => anchorImages.has(anchor.id))
      .map((anchor) => ({ id: anchor.id, blob: (anchorImages.get(anchor.id) as { blob: Blob }).blob }));
    const key = await computeAnchorSetKey(anchors, hash);

    if (!getCachedSignature(training, placeId, key)) {
      uncachedSignaturePlaceIds.push(placeId);
    }
  }

  return { sortablePlaceIds, plan, uncachedSignaturePlaceIds };
}

export interface SortingRunDeps {
  provider: VisionProvider;
  getTraining: () => PlaceTrainingState;
  commit: (updater: (current: PlaceTrainingState) => PlaceTrainingState) => void;
  anchorImages: SortingAnchorImages;
  prepareCandidateImage: (record: ImageRecord) => Promise<string>;
  isCancelled: () => boolean;
  /** Latest visit; lets a curator's External / Inspiration decision stop in-flight work. Defaults to the starting visit. */
  getVisit?: () => Visit | null;
  onProgress?: (done: number, total: number) => void;
  hash?: BlobHasher;
  now?: () => string;
}

export interface SortingRunSummary {
  signatureCalls: number;
  comparisonCalls: number;
  failures: number;
  stopped: boolean;
  lastError: string;
}

const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Runs one capped batch. Only missing (photograph, place) comparisons are made; existing results are
 * never replaced and no placeId is ever written here. Assignment stays a curator decision.
 */
export async function runSortingBatch(visit: Visit, deps: SortingRunDeps): Promise<SortingRunSummary> {
  const { provider, getTraining, commit, anchorImages } = deps;
  const summary: SortingRunSummary = { signatureCalls: 0, comparisonCalls: 0, failures: 0, stopped: false, lastError: "" };

  if (!provider.matchPlaceCandidate || !provider.derivePlaceSignature) {
    throw new Error("The configured Vision provider cannot compare photographs to a place.");
  }

  const readiness = await computeSortingReadiness(visit, getTraining(), anchorImages, deps.hash);
  const total = readiness.plan.comparisonCount;
  const signatures = new Map<string, Awaited<ReturnType<typeof resolvePlaceSignature>>>();
  let done = 0;
  let consecutiveFailures = 0;

  deps.onProgress?.(0, total);

  const stillEligible = (imageRecordId: string) => isRecordEligibleNow(deps.getVisit ? deps.getVisit() : visit, imageRecordId);

  for (const item of readiness.plan.items) {
    if (deps.isCancelled()) {
      summary.stopped = true;
      break;
    }

    let candidateUrl: string | null = null;

    for (const placeId of item.placeIds) {
      if (deps.isCancelled()) {
        summary.stopped = true;
        break;
      }

      if (!stillEligible(item.record.id)) {
        done += 1;
        deps.onProgress?.(done, total);
        continue;
      }

      try {
        let resolved = signatures.get(placeId);

        if (!resolved) {
          const anchors = getPlaceAnchors(getTraining(), placeId)
            .filter((anchor) => anchorImages.has(anchor.id))
            .map((anchor) => ({ id: anchor.id, blob: (anchorImages.get(anchor.id) as { blob: Blob }).blob }));
          resolved = await resolvePlaceSignature({
            provider,
            placeId,
            placeName: getPlaceById(placeId)?.displayName ?? placeId,
            anchors,
            getTraining,
            commit,
            hash: deps.hash,
            anchorDataUrls: await Promise.all(anchors.map((anchor) => blobToDataUrl(anchor.blob))),
          });
          signatures.set(placeId, resolved);
          if (resolved.derived) {
            summary.signatureCalls += 1;
          }
        }

        candidateUrl ??= await deps.prepareCandidateImage(item.record);
        summary.comparisonCalls += 1;
        const outcome = await provider.matchPlaceCandidate({
          placeId,
          placeName: getPlaceById(placeId)?.displayName ?? placeId,
          imageRecordId: item.record.id,
          candidateImageDataUrl: candidateUrl,
          anchorImageDataUrls: resolved.anchorDataUrls,
          signature: resolved.signature,
        });

        if (!stillEligible(item.record.id)) {
          done += 1;
          deps.onProgress?.(done, total);
          continue;
        }

        const resultId = createMatchResultId(outcome.placeId, outcome.imageRecordId);
        commit((current) =>
          current.matchResults.some((existing) => existing.id === resultId && existing.classification)
            ? current
            : upsertMatchResult(current, {
            id: resultId,
            placeId: outcome.placeId,
            imageRecordId: outcome.imageRecordId,
            classification: outcome.classification,
            matchedFeatures: outcome.matchedFeatures,
            score: outcome.score,
            reason: outcome.reason,
            provider: outcome.provider,
            analysisVersion: outcome.analysisVersion,
            engineVersion: outcome.engineVersion,
            matchedAt: (deps.now ?? (() => new Date().toISOString()))(),
            status: "pending",
          })
        );
        consecutiveFailures = 0;
      } catch (error) {
        summary.failures += 1;
        consecutiveFailures += 1;
        summary.lastError = error instanceof Error ? error.message : "Unknown error";

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          summary.stopped = true;
          break;
        }
      }

      done += 1;
      deps.onProgress?.(done, total);
    }

    if (summary.stopped) {
      break;
    }
  }

  return summary;
}
