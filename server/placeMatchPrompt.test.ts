import { describe, expect, it } from "vitest";
import { buildPlaceMatchInstructions, buildPlaceSignatureInstructions } from "./placeMatchPrompt";

const signature = {
  core: ["core thing"],
  supporting: ["supporting thing"],
  contextual: ["context thing"],
};

describe("buildPlaceSignatureInstructions", () => {
  const prompt = buildPlaceSignatureInstructions("The Example Place", 4);

  it("is generic, anchor-only and keeps core small and discriminative", () => {
    expect(prompt).toContain('"The Example Place"');
    expect(prompt).toContain("ONLY");
    expect(prompt).toMatch(/1 to 4 entries/);
    expect(prompt).toMatch(/Never put generic materials/);
    expect(prompt).toMatch(/empty core/);
    expect(prompt).not.toMatch(/trellis|rock garden/i);
  });
});

describe("buildPlaceMatchInstructions", () => {
  const prompt = buildPlaceMatchInstructions("The Example Place", 4, signature);

  it("is generic and names the place and anchor count it is given", () => {
    expect(prompt).toContain('"The Example Place"');
    expect(prompt).toContain("REFERENCE 1 to REFERENCE 4");
    expect(prompt).not.toMatch(/rock garden/i);
  });

  it("embeds the fixed signature lists", () => {
    expect(prompt).toContain("- core thing");
    expect(prompt).toContain("- supporting thing");
    expect(prompt).toContain("- context thing");
    expect(prompt).toMatch(/Do not redefine it/);
  });

  it("requires one explicit class and defines all three", () => {
    expect(prompt).toMatch(/SAME_PLACE:/);
    expect(prompt).toMatch(/NEARBY_CONTEXT:/);
    expect(prompt).toMatch(/DIFFERENT_PLACE:/);
  });

  it("requires a core feature plus a second feature and excludes context features", () => {
    expect(prompt).toMatch(/at least ONE core feature and at least TWO distinct core or supporting features/);
    expect(prompt).toMatch(/Context features alone can never produce SAME_PLACE/);
    expect(prompt).toMatch(/uncertain between SAME_PLACE and NEARBY_CONTEXT, choose NEARBY_CONTEXT/);
    expect(prompt).toMatch(/VERBATIM/);
  });

  it("renders empty lists explicitly", () => {
    expect(buildPlaceMatchInstructions("P", 3, { core: [], supporting: [], contextual: [] })).toContain("(none)");
  });
});
