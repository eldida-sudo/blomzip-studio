import type { PlaceSignature } from "./placeMatchContract";

export function buildPlaceSignatureInstructions(placeName: string, anchorCount: number): string {
  return (
    `You are helping a curator describe one specific place in the Blomzip courtyard garden: "${placeName}". ` +
    `All ${anchorCount} images are REFERENCE images that the curator confirmed show exactly this place. ` +
    "Derive a stable visual signature of the place from these references ONLY, as short noun phrases.\n\n" +
    "- core: the fixed physical features that are visible in MOST of the references AND that materially distinguish this place " +
    "from neighbouring areas of the courtyard. A core feature must be something a person could use to tell this exact spot from the next spot along: " +
    "ask whether it would also be visible, or look the same, a few metres away, and if so it is NOT core. " +
    "Prefer specific, nameable structures or arrangements over broad categories (for example a particular tree trunk, a distinctive structure, a specific bed edge or a unique plant grouping, rather than just a tree, plants or a bed). " +
    "Keep it small and discriminative: 1 to 4 entries. " +
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
  const requiredCoreText =
    signature.core.length >= 2
      ? "at least TWO distinct CORE features are clearly visible"
      : "at least ONE CORE feature is clearly visible";

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
    "MISSING versus CONTRADICTORY evidence:\n" +
    "- A feature that is outside the frame, hidden, blurred, too small or simply not visible is MISSING. Missing evidence is not a conflict: do not list it in conflicts. It only reduces how many features you can verify.\n" +
    "- A conflict is a CORE feature that the candidate clearly shows to be different, for example a different structure or arrangement clearly visible where that core feature should be. " +
    "Only list a core feature (copied VERBATIM) in conflicts when you can see the contradicting evidence in the candidate. When in doubt, leave conflicts empty and prefer NEARBY_CONTEXT.\n\n" +
    "Classify the CANDIDATE as exactly one of:\n" +
    `SAME_PLACE: ${requiredCoreText} AND at least TWO distinct core or supporting features in total are clearly visible in the candidate, AND nothing in the candidate contradicts a core feature.\n` +
    "NEARBY_CONTEXT: the candidate was taken in or near the same courtyard and context features match, but the place-defining structure " +
    "is not clearly visible, there is not enough distinctive evidence, or the SAME_PLACE requirement is not met.\n" +
    "DIFFERENT_PLACE: the candidate shows a different part of the garden or something unrelated.\n\n" +
    "Rules:\n" +
    "- Context features alone can never produce SAME_PLACE.\n" +
    "- Without a visible core feature the answer cannot be SAME_PLACE.\n" +
    "- Features shared with neighbouring areas are not distinctive evidence; if the only matches could also describe a neighbouring area, choose NEARBY_CONTEXT.\n" +
    "- If you are uncertain between SAME_PLACE and NEARBY_CONTEXT, choose NEARBY_CONTEXT.\n" +
    "- Camera angle and distance may differ; judge the features, not the viewpoint.\n\n" +
    "Output: classification; core_matched and supporting_matched, listing ONLY features copied VERBATIM from the signature lists above " +
    "that you verified in the candidate (never contextual features, never new or reworded features; use empty lists if none); " +
    "conflicts, listing ONLY core features copied VERBATIM from the signature that are clearly contradicted by visible evidence in the candidate (usually empty); a short reason (one or two sentences) naming what matched or what was missing; " +
    "and a score from 0 to 1 that agrees with the classification and is secondary to it " +
    "(a rough model estimate, not a probability; SAME_PLACE 0.6-1.0, NEARBY_CONTEXT 0.1-0.5, DIFFERENT_PLACE 0-0.2)."
  );
}
