import type { PlaceSignature } from "./placeMatchContract";

export function buildPlaceSignatureInstructions(placeName: string, anchorCount: number): string {
  return (
    `You are helping a curator describe one specific place in the Blomzip courtyard garden: "${placeName}". ` +
    `All ${anchorCount} images are REFERENCE images that the curator confirmed show exactly this place. ` +
    "Derive a stable visual signature of the place from these references ONLY, as short noun phrases.\n\n" +
    "- core: the fixed physical features that are visible in MOST of the references AND that materially distinguish this place " +
    "from neighbouring areas of the courtyard. Keep it small and discriminative: 1 to 4 entries. " +
    "Never put generic materials or common courtyard elements (paving, gravel, soil, grass, generic planting, walls, sky) in core. " +
    "If nothing is both common to the references and distinctive, return an empty core.\n" +
    "- supporting: features specific to this place that help confirm it but are less distinctive or not in most references.\n" +
    "- contextual: things that are merely around the place or shared with other courtyard areas " +
    "(neighbouring facades, trees, parking, paths, nearby rocks, beds or paving that are not part of the place, lighting, season, people, vehicles). " +
    "Contextual features can never establish the place by themselves.\n\n" +
    "Each feature must appear in exactly one list. Use consistent, short, self-contained phrases."
  );
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "(none)";
}

export function buildPlaceMatchInstructions(placeName: string, anchorCount: number, signature: PlaceSignature): string {
  return (
    `You are helping a curator decide whether a photograph shows one specific place in the Blomzip courtyard garden: "${placeName}". ` +
    `The next ${anchorCount} images are REFERENCE images that the curator confirmed show exactly this place, ` +
    `labelled REFERENCE 1 to REFERENCE ${anchorCount}. The final image is the CANDIDATE.\n\n` +
    "The place has a FIXED visual signature derived from the references. Do not redefine it.\n" +
    `CORE features (fixed, distinctive):\n${formatList(signature.core)}\n` +
    `SUPPORTING features:\n${formatList(signature.supporting)}\n` +
    `CONTEXTUAL features (shared with nearby areas; never evidence of the same place):\n${formatList(signature.contextual)}\n\n` +
    "Check which CORE and SUPPORTING features are clearly visible in the CANDIDATE. " +
    "Context features, lighting, season, weather, people and vehicles are expected to be shared and are never evidence of the same place.\n\n" +
    "Classify the CANDIDATE as exactly one of:\n" +
    "SAME_PLACE: at least ONE core feature and at least TWO distinct core or supporting features in total are clearly visible in the candidate.\n" +
    "NEARBY_CONTEXT: the candidate was taken in or near the same courtyard and context features match, but the place-defining structure " +
    "is not clearly visible, or the SAME_PLACE requirement is not met.\n" +
    "DIFFERENT_PLACE: the candidate shows a different part of the garden or something unrelated.\n\n" +
    "Rules:\n" +
    "- Context features alone can never produce SAME_PLACE.\n" +
    "- Without a visible core feature the answer cannot be SAME_PLACE.\n" +
    "- If you are uncertain between SAME_PLACE and NEARBY_CONTEXT, choose NEARBY_CONTEXT.\n" +
    "- Camera angle and distance may differ; judge the features, not the viewpoint.\n\n" +
    "Output: classification; core_matched and supporting_matched, listing ONLY features copied VERBATIM from the signature lists above " +
    "that you verified in the candidate (never contextual features, never new or reworded features; use empty lists if none); " +
    "a short reason (one or two sentences) naming what matched or what was missing; " +
    "and a score from 0 to 1 that agrees with the classification and is secondary to it " +
    "(SAME_PLACE 0.6-1.0, NEARBY_CONTEXT 0.1-0.5, DIFFERENT_PLACE 0-0.2)."
  );
}
