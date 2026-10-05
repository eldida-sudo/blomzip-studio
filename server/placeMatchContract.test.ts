import { describe, expect, it } from "vitest";
import {
  describePlaceMatchViolation,
  describePlaceSignatureViolation,
  enforcePlaceSignature,
  parsePlaceSignature,
  type PlaceSignature,
} from "./placeMatchContract";

const signature: PlaceSignature = {
  core: ["lattice screen", "climbing frame"],
  supporting: ["gravel bay"],
  contextual: ["wooden-bordered flower bed", "granite rock outcrop", "small paving tiles"],
};

const raw = {
  classification: "SAME_PLACE",
  score: 0.85,
  reason: "Matches.",
  core_matched: ["lattice screen"],
  supporting_matched: ["gravel bay"],
};

const run = (overrides: Record<string, unknown>, sig: PlaceSignature = signature) =>
  enforcePlaceSignature(JSON.stringify({ ...raw, ...overrides }), sig);

describe("describePlaceMatchViolation", () => {
  it("accepts the exact model contract", () => {
    expect(describePlaceMatchViolation(JSON.stringify(raw))).toBeNull();
  });

  it("rejects missing, null or differently cased classification without inferring one", () => {
    const { classification: _omit, ...rest } = raw;
    expect(describePlaceMatchViolation(JSON.stringify(rest))).toContain("unexpected keys");
    expect(describePlaceMatchViolation(JSON.stringify({ ...raw, classification: null }))).toContain("invalid classification");
    expect(describePlaceMatchViolation(JSON.stringify({ ...raw, classification: "same_place" }))).toContain("invalid classification");
  });

  it("rejects wrapped, extended or legacy shapes", () => {
    expect(describePlaceMatchViolation(JSON.stringify({ result: raw }))).toContain("unexpected keys");
    expect(describePlaceMatchViolation(JSON.stringify({ ...raw, extra: 1 }))).toContain("unexpected keys");
    expect(describePlaceMatchViolation(JSON.stringify({ ...raw, matched_features: [] }))).toContain("unexpected keys");
  });

  it("rejects bad lists, non-JSON and non-object output", () => {
    expect(describePlaceMatchViolation(JSON.stringify({ ...raw, core_matched: "x" }))).toContain("core_matched");
    expect(describePlaceMatchViolation("```json\n{}\n```")).toBe("output is not valid JSON");
    expect(describePlaceMatchViolation("[]")).toBe("output is not a JSON object");
  });
});

describe("place signature parsing", () => {
  it("accepts a valid signature, including an empty core", () => {
    expect(parsePlaceSignature(JSON.stringify(signature))).toEqual({ signature });
    expect(describePlaceSignatureViolation({ ...signature, core: [] })).toBeNull();
  });

  it("rejects more than four core features instead of truncating", () => {
    const core = ["a", "b", "c", "d", "e"];
    expect(describePlaceSignatureViolation({ ...signature, core })).toContain("more than 4");
  });

  it("rejects duplicated, blank, missing and extra entries", () => {
    expect(describePlaceSignatureViolation({ ...signature, supporting: ["lattice screen"] })).toContain("more than once");
    expect(describePlaceSignatureViolation({ ...signature, core: [" "] })).toContain("blank");
    expect(describePlaceSignatureViolation({ core: [], supporting: [] })).toContain("unexpected keys");
    expect(describePlaceSignatureViolation({ ...signature, extra: [] })).toContain("unexpected keys");
    expect(parsePlaceSignature("nope")).toEqual({ violation: "output is not valid JSON" });
  });
});

describe("enforcePlaceSignature", () => {
  it("keeps SAME_PLACE with one core and one supporting feature and emits the exact contract", () => {
    const { result } = run({});
    expect(result).toEqual({
      classification: "SAME_PLACE",
      score: 0.85,
      reason: "Matches.",
      matched_features: ["lattice screen", "gravel bay"],
    });
  });

  it("downgrades the Parking Trellis false positive: only contextual features claimed", () => {
    const { result, dropped } = run({
      core_matched: [],
      supporting_matched: ["wooden-bordered flower bed", "granite rock outcrop", "small paving tiles"],
    });
    expect(result.classification).toBe("NEARBY_CONTEXT");
    expect(result.matched_features).toEqual([]);
    expect(dropped).toEqual(["wooden-bordered flower bed", "granite rock outcrop", "small paving tiles"]);
  });

  it("downgrades SAME_PLACE with supporting features only, or with a single core feature", () => {
    expect(run({ core_matched: [], supporting_matched: ["gravel bay"] }).result.classification).toBe("NEARBY_CONTEXT");
    expect(run({ supporting_matched: [] }).result.classification).toBe("NEARBY_CONTEXT");
  });

  it("allows two core features", () => {
    const { result } = run({ core_matched: ["lattice screen", "climbing frame"], supporting_matched: [] });
    expect(result.classification).toBe("SAME_PLACE");
  });

  it("drops reworded, re-cased, unknown or misfiled features rather than repairing them", () => {
    const { result, dropped } = run({
      core_matched: ["Lattice Screen", "gravel bay"],
      supporting_matched: ["lattice screen", "gravel bay", "gravel bay"],
    });
    expect(dropped).toEqual(["Lattice Screen", "gravel bay", "lattice screen"]);
    expect(result.matched_features).toEqual(["gravel bay"]);
    expect(result.classification).toBe("NEARBY_CONTEXT");
  });

  it("makes SAME_PLACE impossible when the signature has no core", () => {
    const { result } = run({ supporting_matched: ["gravel bay"] }, { ...signature, core: [] });
    expect(result.classification).toBe("NEARBY_CONTEXT");
  });

  it("never upgrades or changes other classifications", () => {
    expect(run({ classification: "NEARBY_CONTEXT" }).result.classification).toBe("NEARBY_CONTEXT");
    expect(run({ classification: "DIFFERENT_PLACE", score: 0.1 }).result.classification).toBe("DIFFERENT_PLACE");
  });
});
