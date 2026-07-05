import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMockObservationSet, EntryReview } from "./EntryReview";
import type { Visit } from "../models/blomzip";

const visit: Visit = {
  id: "visit-1",
  placeId: "place-1",
  date: "2026-07-05",
  entries: [
    {
      id: "entry-1",
      imageRecordId: "image-1",
      visitId: "visit-1",
      status: "new",
      notes: "",
      tags: [],
      observations: [],
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    },
    {
      id: "entry-2",
      imageRecordId: "image-2",
      visitId: "visit-1",
      status: "new",
      notes: "",
      tags: [],
      observations: [],
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
    },
  ],
  imageRecords: [
    {
      id: "image-1",
      filename: "courtyard-01.jpg",
      fileSize: 1200,
      format: "jpeg",
      sourcePath: "courtyard-01.jpg",
      width: 1600,
      height: 1200,
      orientation: "landscape",
      mimeType: "image/jpeg",
      timelineIndex: 0,
      thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
    },
    {
      id: "image-2",
      filename: "courtyard-02.jpg",
      fileSize: 1600,
      format: "jpeg",
      sourcePath: "courtyard-02.jpg",
      width: 1200,
      height: 1600,
      orientation: "portrait",
      mimeType: "image/jpeg",
      timelineIndex: 1,
      thumbnailUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
    },
  ],
  imageCount: 2,
  status: "Ready for AI",
};

describe("EntryReview", () => {
  it("renders entry review details and review controls", () => {
    const html = renderToStaticMarkup(<EntryReview visit={visit} />);

    expect(html).toContain("Entry review");
    expect(html).toContain("courtyard-01.jpg");
    expect(html).toContain("Timeline index");
    expect(html).toContain("0 observations");
    expect(html).toContain("Ready for AI");
    expect(html).toContain("Notes");
    expect(html).toContain("Tags");
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
    expect(html).toContain("Analyze image");
  });

  it("creates mock observations for the matching entry", () => {
    const observations = createMockObservationSet("entry-1");

    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((observation) => observation.entryId === "entry-1")).toBe(true);
    expect(observations.every((observation) => observation.source === "mock-ai")).toBe(true);
  });

  it("hides the analyze button once observations exist", () => {
    const html = renderToStaticMarkup(
      <EntryReview
        visit={{
          ...visit,
          entries: [
            {
              ...visit.entries[0],
              observations: [
                {
                  id: "obs-1",
                  entryId: "entry-1",
                  type: "Plant",
                  confidence: 0.98,
                  source: "mock-ai",
                  value: "Flower",
                  createdAt: "2026-07-05T00:00:00.000Z",
                  reviewed: false,
                },
              ],
            },
            ...visit.entries.slice(1),
          ],
        }}
      />
    );

    expect(html).toContain("1 observations");
    expect(html).not.toContain("Analyze image");
  });
});
