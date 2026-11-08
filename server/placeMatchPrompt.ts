import type { PlaceSignature } from "./placeMatchContract";

export function buildPlaceSignatureInstructions(placeName: string, anchorCount: number): string {
  return (
    `You are helping a curator describe one specific place in the Blomzip courtyard garden: "${placeName}". ` +
    `All ${anchorCount} images are REFERENCE images that the curator confirmed show exactly this place. ` +
    "Derive a stable visual signature of the place from these references ONLY, as short noun phrases.\n\n" +
    "- core: the fixed physical geometry and spatial relationships that are visible in MOST of the references AND that materially distinguish this place " +
    "from neighbouring areas of the courtyard. Prefer fixed boundaries, shapes, alignments, adjacency and the relative placement of structures. " +
    "A core feature must be something a person could use to tell this exact spot from the next spot along: " +
    "ask whether it would also be visible, or look the same, a few metres away, and if so it is NOT core. " +
    "Prefer specific, nameable fixed structures or arrangements over broad categories. Generic objects, vegetation and paving are weak evidence; " +
    "do not make them core unless an unusually distinctive fixed arrangement makes them place-defining. " +
    "Keep it small and discriminative: 1 to 4 entries. " +
    "Never put generic materials or common courtyard elements (paving, gravel, soil, grass, generic planting, walls, sky) in core. " +
    "If nothing is both common to the references and distinctive, return an empty core.\n" +
    "- supporting: specific, verifiable features or spatial details that help confirm this place but are less distinctive or not in most references. " +
    "Do not promote generic objects, vegetation or paving, or anything shared across the courtyard, to supporting evidence.\n" +
    "- contextual: things that are merely around the place or shared with other courtyard areas " +
    "(neighbouring facades, trees, parking, paths, nearby rocks, beds or paving that are not part of the place, lighting, season, people, vehicles). " +
    "Contextual features can never establish the place by themselves.\n\n" +
    "Each feature must appear in exactly one list. Use consistent, short, self-contained phrases."
  );
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "(none)";
}

export interface MatchFocusAssessment {
  frameType: string;
  confidence: number;
  reason: string;
  primaryPlaceId?: string | null;
  secondaryVisiblePlaceIds?: string[];
}

export function buildPlaceMatchInstructions(
  placeName: string,
  anchorCount: number,
  signature: PlaceSignature,
  targetPlaceId?: string,
  focus?: MatchFocusAssessment
): string {
  const focusContext = focus
    ? `A separate image-framing assessment reports: frame type ${focus.frameType}, confidence ${Math.round(focus.confidence * 100)}%, primary place ${focus.primaryPlaceId ?? "none"}, secondary visible places ${focus.secondaryVisiblePlaceIds?.join(", ") || "none"}. Its visual reason: ${focus.reason}. The place currently being compared is ${targetPlaceId ?? placeName}. Treat named secondary places as nearby context, never as the image's primary place. If this comparison targets a secondary visible place, do not classify it SAME_PLACE; use NEARBY_CONTEXT. If a reliable focused-place assessment names a different primary place, do not override it based only on shared scenery; use NEARBY_CONTEXT unless the assessment is clearly contradicted by the candidate image.\\n\\n`
    : "";
  return (
    `You are helping a curator decide whether a photograph shows one specific place in the Blomzip courtyard garden: "${placeName}". ` +
    `The next ${anchorCount} images are REFERENCE images that the curator confirmed show exactly this place, ` +
    `labelled REFERENCE 1 to REFERENCE ${anchorCount}. The final image is the CANDIDATE.\n\n` +
    "The place has a FIXED visual signature derived from the references. Do not redefine it.\n" +
    `CORE features (fixed, distinctive):\n${formatList(signature.core)}\n` +
    `SUPPORTING features:\n${formatList(signature.supporting)}\n` +
    `CONTEXTUAL features (shared with nearby areas; never evidence of the same place):\n${formatList(signature.contextual)}\n\n` +
    "Check which CORE and SUPPORTING features are clearly visible in the CANDIDATE. " +
    "Treat matching fixed geometry and spatial relationships as stronger evidence than generic objects, vegetation or paving. " +
    "A broad object or material match is weak and does not become place-defining merely because it appears in the signature. " +
    "Context features, lighting, season, weather, people and vehicles are expected to be shared and are never evidence of the same place.\n\n" +
    "MISSING versus CONTRADICTORY evidence:\n" +
    "- A feature that is outside the frame, hidden, blurred, too small or simply not visible is MISSING. Missing evidence is not a conflict: do not list it in conflicts. It only reduces how many features you can verify.\n" +
    "- A conflict is a CORE feature that the candidate clearly shows to be different, for example a different structure or arrangement clearly visible where that core feature should be. " +
    "Only list a core feature (copied VERBATIM) in conflicts when you can see the contradicting evidence in the candidate. When in doubt, leave conflicts empty and prefer NEARBY_CONTEXT.\n\n" +
    focusContext +
    "Before matching, identify the photograph’s primary visual focus. A place visible only in the background or as incidental context is not the primary place. " +
    "A close-up that does not show the fixed, place-defining anchors cannot establish SAME_PLACE, even if plants or materials resemble the references. " +
    "If two or more distinct courtyard places are visible and none is clearly the primary focus, do not treat the whole frame as one place; use NEARBY_CONTEXT when it is clearly the same courtyard, otherwise DIFFERENT_PLACE. " +
    "A broad courtyard overview is not SAME_PLACE for any one constituent area unless one specific area is clearly the primary focus and its fixed anchors are visible. " +
    "State in the reason whether the candidate is a focused view, a close-up without anchors, or a multi-place/overview frame. " +
    "Classify the CANDIDATE as exactly one of:\n" +
    "SAME_PLACE: either at least TWO distinct CORE features, OR at least ONE CORE feature and TWO distinct SUPPORTING features, are clearly visible in the candidate, AND nothing in the candidate contradicts a core feature.\n" +
    "NEARBY_CONTEXT: the candidate was taken in or near the same courtyard and context features match, but the place-defining structure " +
    "is not clearly visible, there is not enough distinctive evidence, or the SAME_PLACE requirement is not met.\n" +
    "DIFFERENT_PLACE: the candidate shows a different part of the garden or something unrelated.\n\n" +
    "Rules:\n" +
    "- Context features alone can never produce SAME_PLACE.\n" +
    "- Without a visible core feature the answer cannot be SAME_PLACE.\n" +
    "- Count only distinct, clearly visible features listed in the fixed signature; never invent, infer or reword supporting evidence.\n" +
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
