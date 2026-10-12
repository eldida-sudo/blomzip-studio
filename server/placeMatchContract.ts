const CLASSIFICATIONS = ["SAME_PLACE", "NEARBY_CONTEXT", "DIFFERENT_PLACE"];
const MODEL_OUTPUT_KEYS = ["classification", "conflicts", "core_matched", "reason", "score", "supporting_matched"];
const SIGNATURE_KEYS = ["contextual", "core", "supporting"];

export const MAX_CORE_FEATURES = 4;
export const MIN_SAME_PLACE_SIGNATURE_FEATURES = 2;
export const MIN_SAME_PLACE_CORE_FEATURES_WHEN_MULTIPLE = 2;
export const DOWNGRADED_SCORE_CAP = 0.5;

export interface PlaceSignature {
  core: string[];
  supporting: string[];
  contextual: string[];
}

export interface PlaceMatchResult {
  classification: "SAME_PLACE" | "NEARBY_CONTEXT" | "DIFFERENT_PLACE";
  score: number;
  reason: string;
  matched_features: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseJsonObject(text: string): { record: Record<string, unknown> } | { violation: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { violation: "output is not valid JSON" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { violation: "output is not a JSON object" };
  }

  return { record: parsed as Record<string, unknown> };
}

function describeKeyViolation(record: Record<string, unknown>, expected: string[]): string | null {
  const keys = Object.keys(record).sort();
  return keys.join(",") === expected.join(",") ? null : `unexpected keys [${keys.join(", ")}]`;
}

/**
 * Describes how a signature violates the contract, or null when valid. A signature with an
 * empty `core` is valid on purpose: it makes SAME_PLACE impossible rather than being repaired.
 */
export function describePlaceSignatureViolation(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "signature is not an object";
  }

  const record = value as Record<string, unknown>;
  const keyViolation = describeKeyViolation(record, SIGNATURE_KEYS);

  if (keyViolation) {
    return `signature has ${keyViolation}`;
  }

  const seen = new Set<string>();

  for (const name of SIGNATURE_KEYS) {
    const list = record[name];

    if (!isStringArray(list)) {
      return `signature.${name} is not a string array`;
    }

    for (const feature of list) {
      if (!feature.trim() || feature !== feature.trim()) {
        return `signature.${name} contains a blank or untrimmed entry`;
      }

      if (seen.has(feature)) {
        return `signature feature ${JSON.stringify(feature)} appears more than once`;
      }

      seen.add(feature);
    }
  }

  if ((record.core as string[]).length > MAX_CORE_FEATURES) {
    return `signature.core has more than ${MAX_CORE_FEATURES} entries`;
  }

  return null;
}

export function parsePlaceSignature(outputText: string): { signature: PlaceSignature } | { violation: string } {
  const parsed = parseJsonObject(outputText);

  if ("violation" in parsed) {
    return parsed;
  }

  const violation = describePlaceSignatureViolation(parsed.record);
  return violation ? { violation } : { signature: parsed.record as unknown as PlaceSignature };
}

/**
 * Returns a description of how the upstream match output violates its contract, or null.
 * It never repairs, re-cases or infers values.
 */
export function describePlaceMatchViolation(outputText: string): string | null {
  const parsed = parseJsonObject(outputText);

  if ("violation" in parsed) {
    return parsed.violation;
  }

  const record = parsed.record;
  const keyViolation = describeKeyViolation(record, MODEL_OUTPUT_KEYS);

  if (keyViolation) {
    return keyViolation;
  }

  if (typeof record.classification !== "string" || !CLASSIFICATIONS.includes(record.classification)) {
    return `invalid classification ${JSON.stringify(record.classification)}`;
  }

  if (typeof record.score !== "number" || !Number.isFinite(record.score)) {
    return "score is not a finite number";
  }

  if (typeof record.reason !== "string") {
    return "reason is not a string";
  }

  if (!isStringArray(record.core_matched)) {
    return "core_matched is not a string array";
  }

  if (!isStringArray(record.supporting_matched)) {
    return "supporting_matched is not a string array";
  }

  if (!isStringArray(record.conflicts)) {
    return "conflicts is not a string array";
  }

  return null;
}

/** How many verified core features SAME_PLACE needs for a signature with this many core features. */
export function requiredCoreFeatures(signatureCoreCount: number): number {
  return signatureCoreCount >= 2 ? MIN_SAME_PLACE_CORE_FEATURES_WHEN_MULTIPLE : 1;
}

export interface PlaceMatchEnforcement {
  result: PlaceMatchResult;
  dropped: string[];
  downgradeReasons: string[];
}

/**
 * Applies the fixed anchor-derived signature to a contract-valid model output. Matched features
 * that are not verbatim entries of the right signature list are dropped, never repaired.
 *
 * SAME_PLACE survives only with enough verified core features (two when the signature has two or more
 * core features, otherwise one), at least two distinct core/supporting features in total, and no
 * contradiction. `conflicts` may only name verbatim core features that the model reports as clearly
 * contradicted by what is visible. Features that are merely absent, out of frame or obscured are not
 * conflicts and must not be listed. A conflict, or a feature reported both matched and conflicting,
 * downgrades SAME_PLACE to NEARBY_CONTEXT. Downgrades never go further and never upgrade.
 */
export function enforcePlaceSignature(outputText: string, signature: PlaceSignature): PlaceMatchEnforcement {
  const record = JSON.parse(outputText) as {
    classification: PlaceMatchResult["classification"];
    score: number;
    reason: string;
    core_matched: string[];
    supporting_matched: string[];
    conflicts: string[];
  };

  const dropped: string[] = [];
  const keep = (matched: string[], allowed: string[]) => {
    const kept: string[] = [];

    for (const feature of matched) {
      if (allowed.includes(feature) && !kept.includes(feature)) {
        kept.push(feature);
      } else if (!allowed.includes(feature)) {
        dropped.push(feature);
      }
    }

    return kept;
  };

  const core = keep(record.core_matched, signature.core);
  const supporting = keep(record.supporting_matched, signature.supporting);
  const conflicts = keep(record.conflicts, signature.core);
  const matchedFeatures = [...core, ...supporting];

  const downgradeReasons: string[] = [];

  if (record.classification === "SAME_PLACE") {
    const requiredCore = requiredCoreFeatures(signature.core.length);

    if (core.length < requiredCore) {
      downgradeReasons.push(`needs ${requiredCore} core feature(s), verified ${core.length}`);
    }

    if (matchedFeatures.length < MIN_SAME_PLACE_SIGNATURE_FEATURES) {
      downgradeReasons.push(`needs ${MIN_SAME_PLACE_SIGNATURE_FEATURES} verified features, verified ${matchedFeatures.length}`);
    }

    if (conflicts.length > 0) {
      downgradeReasons.push(`contradicted core feature(s): ${conflicts.join(", ")}`);
    }
  }

  const downgraded = downgradeReasons.length > 0;

  return {
    result: {
      classification: downgraded ? "NEARBY_CONTEXT" : record.classification,
      score: downgraded ? Math.min(record.score, DOWNGRADED_SCORE_CAP) : record.score,
      reason: record.reason,
      matched_features: matchedFeatures,
    },
    dropped,
    downgradeReasons,
  };
}
