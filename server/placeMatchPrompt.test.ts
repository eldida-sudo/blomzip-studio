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
    expect(prompt).toMatch(/fixed physical geometry and spatial relationships/);
    expect(prompt).toMatch(/Generic objects, vegetation and paving are weak evidence/);
    expect(prompt).not.toMatch(/trellis|rock garden/i);
  });

  it("asks for features that tell this spot from the next, without naming neighbouring places", () => {
    expect(prompt).toMatch(/a few metres away/);
    expect(prompt).toMatch(/is NOT core/);
    expect(prompt).not.toMatch(/Seating Area|Raised Beds|Parking|Under the Maple/);
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

  it("separates missing evidence from contradictory evidence", () => {
    expect(prompt).toMatch(/outside the frame, hidden, blurred, too small or simply not visible is MISSING/);
    expect(prompt).toMatch(/Missing evidence is not a conflict/);
    expect(prompt).toMatch(/When in doubt, leave conflicts empty and prefer NEARBY_CONTEXT/);
  });

  it("requires two core features or one core and two supporting features", () => {
    expect(prompt).toMatch(/at least TWO distinct CORE features, OR at least ONE CORE feature and TWO distinct SUPPORTING features/);
    expect(prompt).toMatch(/Context features alone can never produce SAME_PLACE/);
    expect(prompt).toMatch(/never invent, infer or reword supporting evidence/);
    expect(prompt).toMatch(/uncertain between SAME_PLACE and NEARBY_CONTEXT, choose NEARBY_CONTEXT/);
    expect(prompt).toMatch(/VERBATIM/);
  });

  it("prioritizes fixed geometry over generic objects, vegetation, paving and shared context", () => {
    expect(prompt).toMatch(/fixed geometry and spatial relationships as stronger evidence/);
    expect(prompt).toMatch(/broad object or material match is weak/);
    expect(prompt).toMatch(/shared with nearby areas/);
  });

  it("renders empty lists explicitly", () => {
    expect(buildPlaceMatchInstructions("P", 3, { core: [], supporting: [], contextual: [] })).toContain("(none)");
  });
});
