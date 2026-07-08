/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest";
import { initialImages } from "../data/demoImages";
import type { Visit } from "../models/blomzip";
import {
  createDraftVisitFromState,
  loadDraftWorkspace,
  saveDraftWorkspace,
  upsertDraftVisit,
} from "./draftWorkspace";

const visit: Visit = {
  id: "visit-1",
  placeId: "place-1",
  date: "2026-07-08",
  entries: [
    {
      id: "entry-1",
      imageRecordId: "image-1",
      visitId: "visit-1",
      status: "new",
      notes: "Draft note",
      tags: ["tag-a"],
      observations: [
        {
          id: "obs-1",
          entryId: "entry-1",
          type: "Plant",
          source: "user",
          value: "Rose",
          createdAt: "2026-07-08T00:00:00.000Z",
          reviewed: true,
          accepted: true,
        },
      ],
      reviewed: true,
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    },
  ],
  imageCount: 1,
  imageRecords: [
    {
      id: "image-1",
      filename: "garden-01.jpg",
      fileSize: 1200,
      format: "jpeg",
      sourcePath: "garden-01.jpg",
      timelineIndex: 0,
      width: 1600,
      height: 1200,
      orientation: "landscape",
      mimeType: "image/jpeg",
      thumbnailUrl: "blob:thumbnail-url",
    },
  ],
  status: "Review in progress",
};

describe("draftWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves and restores draft visits from local storage", () => {
    const draftVisit = createDraftVisitFromState({
      visit,
      studioImages: initialImages.slice(0, 1),
    });

    const workspace = upsertDraftVisit({ drafts: [], activeDraftId: null }, draftVisit);
    saveDraftWorkspace(workspace);

    const restoredWorkspace = loadDraftWorkspace();

    expect(restoredWorkspace.activeDraftId).toBe(visit.id);
    expect(restoredWorkspace.drafts).toHaveLength(1);
    expect(restoredWorkspace.drafts[0]).toEqual(expect.objectContaining({
      id: visit.id,
      label: "Draft 2026-07-08",
      visit: expect.objectContaining({
        id: visit.id,
        status: "Review in progress",
        entries: expect.arrayContaining([
          expect.objectContaining({
            id: "entry-1",
            reviewed: true,
            observations: expect.arrayContaining([
              expect.objectContaining({
                id: "obs-1",
                reviewed: true,
                accepted: true,
              }),
            ]),
          }),
        ]),
      }),
      studioImages: initialImages.slice(0, 1),
    }));
  });
});