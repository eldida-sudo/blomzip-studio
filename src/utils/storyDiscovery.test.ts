import { describe, expect, it } from "vitest";
import type { PlaceMatchResult } from "../models/blomzip";
import { buildStoryProposals, findThenNow, type StoryDiscoveryPhoto } from "./storyDiscovery";

function photo(id: string, captureDate: string | undefined, extra: Partial<StoryDiscoveryPhoto> = {}): StoryDiscoveryPhoto {
  return {
    id,
    src: `blob:${id}`,
    filename: `${id}.jpg`,
    alt: id,
    captureDate,
    storySelected: false,
    hero: false,
    favorite: false,
    recommendationScore: 0,
    signals: [],
    isExternal: false,
    isHidden: false,
    privacyBlocked: false,
    ...extra,
  };
}

function match(imageRecordId: string, placeId: string, features: string[], extra: Partial<PlaceMatchResult> = {}): PlaceMatchResult {
  return {
    id: `${imageRecordId}-${placeId}`,
    placeId,
    imageRecordId,
    classification: "SAME_PLACE",
    matchedFeatures: features,
    score: 0.9,
    reason: "",
    provider: "test",
    analysisVersion: 1,
    matchedAt: "2026-10-01T00:00:00.000Z",
    status: "approved",
    ...extra,
  };
}

const rockYears = [2016, 2018, 2020, 2022, 2024].map((year, index) =>
  photo(`rock-${year}`, `${year}-06-15T12:00:00.000Z`, { placeId: "rock", placeLabel: "Rock Garden", recommendationScore: 0.2 + index * 0.1 })
);

describe("buildStoryProposals", () => {
  it("proposes a place-over-time story with 4-6 photographs, a relevance-ranked opening and a shortlist", () => {
    const extra = [photo("rock-2019", "2019-05-01T12:00:00.000Z", { placeId: "rock", placeLabel: "Rock Garden" }), photo("rock-2021", "2021-05-01T12:00:00.000Z", { placeId: "rock", placeLabel: "Rock Garden" })];
    const [proposal] = buildStoryProposals([...rockYears, ...extra]);

    expect(proposal.kind).toBe("place-over-time");
    expect(proposal.sequence.length).toBeGreaterThanOrEqual(4);
    expect(proposal.sequence.length).toBeLessThanOrEqual(6);
    expect(proposal.openingId).toBe("rock-2024");
    expect(proposal.sequence[0].photo.id).toBe("rock-2024");
    expect(proposal.rationale).toContain("Suggested theme");
    expect(proposal.shortlist.length).toBeGreaterThan(0);
    expect(proposal.shortlist.some((item) => proposal.sequence.some((s) => s.photo.id === item.photo.id))).toBe(false);
  });

  it("never reuses a photograph across proposals and returns at most three", () => {
    const seasons = ["2023-01-10", "2023-04-10", "2023-07-10", "2023-10-10", "2023-11-10"].map((d, i) => photo(`s${i}`, `${d}T12:00:00.000Z`));
    const proposals = buildStoryProposals([...rockYears, ...seasons]);
    const ids = proposals.flatMap((proposal) => proposal.sequence.map((item) => item.photo.id));

    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals.length).toBeLessThanOrEqual(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("excludes external, hidden, privacy-blocked and image-less photographs", () => {
    const bad = [
      photo("ext", "2017-06-15T12:00:00.000Z", { placeId: "rock", isExternal: true }),
      photo("hid", "2017-07-15T12:00:00.000Z", { placeId: "rock", isHidden: true }),
      photo("priv", "2017-08-15T12:00:00.000Z", { placeId: "rock", privacyBlocked: true }),
      photo("svg", "2017-09-15T12:00:00.000Z", { placeId: "rock", src: "data:image/svg+xml;base64,AAAA" }),
    ];
    const ids = buildStoryProposals([...rockYears, ...bad]).flatMap((p) => [...p.sequence, ...p.shortlist].map((i) => i.photo.id));

    expect(ids).not.toEqual(expect.arrayContaining(["ext"]));
    for (const id of ["ext", "hid", "priv", "svg"]) {
      expect(ids).not.toContain(id);
    }
  });

  it("proposes nothing when evidence is too thin, and does not mutate input", () => {
    const thin = [photo("a", "2020-06-01T12:00:00.000Z"), photo("b", "2021-06-01T12:00:00.000Z")];
    const copy = JSON.stringify(thin);

    expect(buildStoryProposals(thin)).toEqual([]);
    expect(buildStoryProposals([])).toEqual([]);
    expect(JSON.stringify(thin)).toBe(copy);
  });

  it("builds a highlights proposal from Story-selected and recommended photographs", () => {
    const picks = [1, 2, 3, 4].map((n) => photo(`h${n}`, undefined, { storySelected: true, recommendationScore: 0.5 }));
    const [proposal] = buildStoryProposals(picks);

    expect(proposal.kind).toBe("highlights");
    expect(proposal.sequence[0].reasons).toContain("Already selected for Story");
  });
});

describe("findThenNow", () => {
  const early = photo("early", "2017-06-01T12:00:00.000Z", { placeId: "rock" });
  const late = photo("late", "2023-06-01T12:00:00.000Z", { placeId: "rock" });

  it("requires approved SAME_PLACE results sharing at least two features", () => {
    const pair = findThenNow([early, late], [match("early", "rock", ["Lattice Screen", "stone step"]), match("late", "rock", ["lattice screen", "Stone step", "bench"])]);

    expect(pair?.before.id).toBe("early");
    expect(pair?.after.id).toBe("late");
    expect(pair?.sharedFeatures).toEqual(["lattice screen", "stone step"]);
  });

  it("omits the comparison for the same place alone, one shared feature, unapproved results or too short a gap", () => {
    expect(findThenNow([early, late], [])).toBeNull();
    expect(findThenNow([early, late], [match("early", "rock", ["a", "b"]), match("late", "rock", ["a", "c"])])).toBeNull();
    expect(findThenNow([early, late], [match("early", "rock", ["a", "b"]), match("late", "rock", ["a", "b"], { status: "pending" })])).toBeNull();
    expect(findThenNow([early, late], [match("early", "rock", ["a", "b"]), match("late", "rock", ["a", "b"], { classification: "NEARBY_CONTEXT" })])).toBeNull();
    const close = photo("close", "2018-06-01T12:00:00.000Z", { placeId: "rock" });
    expect(findThenNow([early, close], [match("early", "rock", ["a", "b"]), match("close", "rock", ["a", "b"])])).toBeNull();
  });
});
