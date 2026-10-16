import type { PlaceTrainingState } from "../models/blomzip";
import { computeContentHash } from "./imageContentHash";
import { VISION_ANALYSIS_VERSION, type PlaceSignature, type VisionProvider } from "./visionProvider";
import { blobToDataUrl } from "./analysisImage";

// Bump when the signature prompt or shape changes so older cached signatures are not reused.
export const SIGNATURE_CACHE_VERSION = 1;

export interface SignatureAnchorInput {
  id: string;
  blob: Blob;
}

export type BlobHasher = (blob: Blob) => Promise<string>;

export const hashBlobContent: BlobHasher = async (blob) =>
  computeContentHash(new Uint8Array(await blob.arrayBuffer()));

/** Identity of one exact anchor set: ids plus image content, so replacing or removing an anchor changes it. */
export async function computeAnchorSetKey(anchors: SignatureAnchorInput[], hash: BlobHasher = hashBlobContent): Promise<string> {
  const parts = await Promise.all(anchors.map(async (anchor) => `${anchor.id}=${await hash(anchor.blob)}`));

  return `v${SIGNATURE_CACHE_VERSION}|a${VISION_ANALYSIS_VERSION}|${parts.sort().join(",")}`;
}

export function getCachedSignature(state: PlaceTrainingState, placeId: string, anchorSetKey: string): PlaceSignature | null {
  const entry = state.signatureCache?.[placeId];

  return entry && entry.anchorSetKey === anchorSetKey ? entry.signature : null;
}

export function cacheSignature(
  state: PlaceTrainingState,
  placeId: string,
  anchorSetKey: string,
  signature: PlaceSignature,
  provider: string,
  now: string = new Date().toISOString()
): PlaceTrainingState {
  return {
    ...state,
    signatureCache: { ...state.signatureCache, [placeId]: { anchorSetKey, signature, provider, derivedAt: now } },
  };
}

export interface ResolveSignatureOptions {
  provider: VisionProvider;
  placeId: string;
  placeName: string;
  anchors: SignatureAnchorInput[];
  getTraining: () => PlaceTrainingState;
  commit: (updater: (current: PlaceTrainingState) => PlaceTrainingState) => void;
  hash?: BlobHasher;
  anchorDataUrls?: string[];
}

/** Reuses a valid cached signature; otherwise derives one (one model call) and caches it. */
export async function resolvePlaceSignature(
  options: ResolveSignatureOptions
): Promise<{ signature: PlaceSignature; derived: boolean; anchorDataUrls: string[] }> {
  const { provider, placeId, placeName, anchors, getTraining, commit } = options;
  const anchorSetKey = await computeAnchorSetKey(anchors, options.hash);
  const anchorDataUrls = options.anchorDataUrls ?? (await Promise.all(anchors.map((anchor) => blobToDataUrl(anchor.blob))));
  const cached = getCachedSignature(getTraining(), placeId, anchorSetKey);

  if (cached) {
    return { signature: cached, derived: false, anchorDataUrls };
  }

  if (!provider.derivePlaceSignature) {
    throw new Error("The configured Vision provider cannot derive a place signature.");
  }

  const signature = await provider.derivePlaceSignature({ placeName, anchorImageDataUrls: anchorDataUrls });
  commit((current) => cacheSignature(current, placeId, anchorSetKey, signature, provider.id));

  return { signature, derived: true, anchorDataUrls };
}
