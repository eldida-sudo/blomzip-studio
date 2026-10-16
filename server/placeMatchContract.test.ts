import { describe, expect, it } from "vitest";
import {
  describePlaceMatchViolation,
  describePlaceSignatureViolation,
  enforcePlaceSignature,
  parsePlaceSignature,
  PLACE_MATCH_ENGINE_VERSION,
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
  conflicts: [] as string[],
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
    expect(describePlaceMatchViolation(JSON.stringify({ ...raw, conflicts: "x" }))).toContain("conflicts");
    expect(describePlaceMatchViolation("```json\n{}\n```")).toBe("output is not valid JSON");
    expect(describePlaceMatchViolation("[]")).toBe("output is not a JSON object");
  });
});

describe("place-match engine version", () => {
  it("identifies the strict place-matching implementation", () => {
    expect(PLACE_MATCH_ENGINE_VERSION).toBe("place-match-precision-v2");
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
  it("keeps SAME_PLACE with two core features and emits the exact contract", () => {
    const { result } = run({ core_matched: ["lattice screen", "climbing frame"] });
    expect(result).toEqual({
      classification: "SAME_PLACE",
      score: 0.85,
      reason: "Matches.",
      matched_features: ["lattice screen", "climbing frame", "gravel bay"],
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

  it("downgrades one core feature plus one supporting feature", () => {
    const { result, downgradeReasons } = run({});
    expect(result.classification).toBe("NEARBY_CONTEXT");
    expect(result.score).toBe(0.5);
    expect(downgradeReasons[0]).toContain("1 core and 2 supporting features");
  });

  it("accepts one core plus two distinct supporting features", () => {
    const { result } = run({
      core_matched: ["lattice screen"],
      supporting_matched: ["gravel bay", "distinctive drain"],
    }, { ...signature, supporting: ["gravel bay", "distinctive drain"] });
    expect(result.classification).toBe("SAME_PLACE");
    expect(result.matched_features).toEqual(["lattice screen", "gravel bay", "distinctive drain"]);
  });

  it("does not count duplicate supporting evidence toward the threshold", () => {
    const { result } = run({
      core_matched: ["lattice screen"],
      supporting_matched: ["gravel bay", "gravel bay"],
    });
    expect(result.classification).toBe("NEARBY_CONTEXT");
    expect(result.matched_features).toEqual(["lattice screen", "gravel bay"]);
  });

  it("drops invented supporting evidence and downgrades the insufficient match", () => {
    const { result, dropped } = run({
      core_matched: ["lattice screen"],
      supporting_matched: ["invented feature one", "invented feature two"],
    });
    expect(result.classification).toBe("NEARBY_CONTEXT");
    expect(result.matched_features).toEqual(["lattice screen"]);
    expect(dropped).toEqual(["invented feature one", "invented feature two"]);
  });

  it("downgrades on a clearly contradicted core feature even when enough features matched", () => {
    const { result, downgradeReasons } = run({
      core_matched: ["lattice screen", "climbing frame"],
      conflicts: [],
    });
    expect(result.classification).toBe("SAME_PLACE");

    const contradicted = run({ core_matched: ["lattice screen", "climbing frame"], conflicts: ["gravel bay"] });
    expect(contradicted.result.classification).toBe("SAME_PLACE"); // gravel bay is not core: invalid conflict is dropped
    expect(contradicted.dropped).toEqual(["gravel bay"]);

    const real = run(
      { core_matched: ["lattice screen", "climbing frame"], supporting_matched: [], conflicts: ["climbing frame"] },
      { ...signature, core: ["lattice screen", "climbing frame", "stone urn"] }
    );
    expect(real.result.classification).toBe("NEARBY_CONTEXT");
    expect(real.result.score).toBeLessThanOrEqual(0.5);
    expect(real.downgradeReasons.join()).toContain("contradicted");
    expect(downgradeReasons).toEqual([]);
  });

  it("two core features are sufficient when other core features are missing", () => {
    const three = { ...signature, core: ["lattice screen", "climbing frame", "stone urn"] };
    const { result, downgradeReasons } = run({ core_matched: ["lattice screen", "climbing frame"], conflicts: [] }, three);
    expect(result.classification).toBe("SAME_PLACE");
    expect(downgradeReasons).toEqual([]);
  });

  it("insufficient evidence downgrades to NEARBY_CONTEXT, not DIFFERENT_PLACE, and invents no conflict", () => {
    const { result, downgradeReasons } = run({ core_matched: ["lattice screen"], supporting_matched: [] });
    expect(result.classification).toBe("NEARBY_CONTEXT");
    expect(downgradeReasons.join()).not.toContain("contradicted");
  });

  it("treats a feature reported as both matched and contradicted as uncertain", () => {
    const { result } = run({ core_matched: ["lattice screen", "climbing frame"], conflicts: ["lattice screen"] });
    expect(result.classification).toBe("NEARBY_CONTEXT");
  });

  it("does not touch the score of non-downgraded or non-SAME_PLACE results", () => {
    expect(run({ core_matched: ["lattice screen", "climbing frame"] }).result.score).toBe(0.85);
    expect(run({ classification: "NEARBY_CONTEXT", score: 0.4, conflicts: ["lattice screen"] }).result.score).toBe(0.4);
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
