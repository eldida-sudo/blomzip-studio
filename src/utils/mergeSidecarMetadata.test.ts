import { describe, expect, it } from "vitest";
import { type ImageRecord } from "../models/blomzip";
import {
  findImageMetadataInSidecar,
  mergeImageSidecarMetadata,
  mergeVisitSidecarMetadata,
} from "./mergeSidecarMetadata";

describe("mergeSidecarMetadata", () => {
  const baseImageRecord: ImageRecord = {
    id: "img-1",
    filename: "photo.jpg",
    fileSize: 2048,
    format: "jpg",
    sourcePath: "photo.jpg",
    captureDate: "2024-01-15T10:00:00Z",
    width: 4000,
    height: 3000,
    aspectRatio: 4 / 3,
    mimeType: "image/jpeg",
  };

  describe("mergeImageSidecarMetadata", () => {
    it("returns unchanged record when no sidecar metadata provided", () => {
      const result = mergeImageSidecarMetadata(baseImageRecord);

      expect(result).toEqual(baseImageRecord);
    });

    it("overrides capture date from sidecar", () => {
      const sidecar = {
        filename: "photo.jpg",
        captureDate: "2024-01-15T14:30:00Z",
      };

      const result = mergeImageSidecarMetadata(baseImageRecord, sidecar);

      expect(result.captureDate).toBe("2024-01-15T14:30:00Z");
    });

    it("overrides dimensions and recalculates aspect ratio", () => {
      const sidecar = {
        filename: "photo.jpg",
        dimensions: { width: 5000, height: 4000 },
      };

      const result = mergeImageSidecarMetadata(baseImageRecord, sidecar);

      expect(result.width).toBe(5000);
      expect(result.height).toBe(4000);
      expect(result.aspectRatio).toBe(5 / 4);
    });

    it("adds location from sidecar", () => {
      const sidecar = {
        filename: "photo.jpg",
        location: {
          latitude: 60.1699,
          longitude: 24.9384,
          name: "Helsinki",
        },
      };

      const result = mergeImageSidecarMetadata(baseImageRecord, sidecar);

      expect(result.location).toEqual({
        latitude: 60.1699,
        longitude: 24.9384,
        name: "Helsinki",
      });
    });

    it("adds notes from sidecar", () => {
      const sidecar = {
        filename: "photo.jpg",
        notes: "Beautiful sunset over the lake",
      };

      const result = mergeImageSidecarMetadata(baseImageRecord, sidecar);

      expect(result.notes).toBe("Beautiful sunset over the lake");
    });

    it("merges tags from sidecar with existing tags", () => {
      const recordWithTags = { ...baseImageRecord, tags: ["landscape"] };
      const sidecar = {
        filename: "photo.jpg",
        tags: ["sunset", "water"],
      };

      const result = mergeImageSidecarMetadata(recordWithTags, sidecar);

      expect(result.tags).toContain("landscape");
      expect(result.tags).toContain("sunset");
      expect(result.tags).toContain("water");
      expect(result.tags?.length).toBe(3); // No duplicates
    });

    it("adds tags even when record has none", () => {
      const sidecar = {
        filename: "photo.jpg",
        tags: ["new", "tags"],
      };

      const result = mergeImageSidecarMetadata(baseImageRecord, sidecar);

      expect(result.tags).toEqual(["new", "tags"]);
    });

    it("merges custom metadata", () => {
      const recordWithCustom = {
        ...baseImageRecord,
        custom: { iso: 200, fstop: "5.6" },
      };
      const sidecar = {
        filename: "photo.jpg",
        custom: { species: "Pine", location: "Forest" },
      };

      const result = mergeImageSidecarMetadata(recordWithCustom, sidecar);

      expect(result.custom).toEqual({
        iso: 200,
        fstop: "5.6",
        species: "Pine",
        location: "Forest",
      });
    });

    it("applies all sidecar metadata at once", () => {
      const sidecar = {
        filename: "photo.jpg",
        captureDate: "2024-01-15T15:00:00Z",
        dimensions: { width: 6000, height: 4000 },
        location: { latitude: 62.5, longitude: 25.7 },
        notes: "Mountain view",
        tags: ["mountain", "scenic"],
        custom: { altitude: 850 },
      };

      const result = mergeImageSidecarMetadata(baseImageRecord, sidecar);

      expect(result.captureDate).toBe("2024-01-15T15:00:00Z");
      expect(result.width).toBe(6000);
      expect(result.height).toBe(4000);
      expect(result.location?.latitude).toBe(62.5);
      expect(result.notes).toBe("Mountain view");
      expect(result.tags).toContain("mountain");
      expect(result.custom?.altitude).toBe(850);
    });
  });

  describe("mergeVisitSidecarMetadata", () => {
    it("returns unchanged date and weather when no sidecar provided", () => {
      const result = mergeVisitSidecarMetadata("2024-01-15", undefined);

      expect(result.date).toBe("2024-01-15");
      expect(result.weather).toBeUndefined();
    });

    it("overrides date from sidecar", () => {
      const sidecarVisit = { date: "2024-01-20" };

      const result = mergeVisitSidecarMetadata("2024-01-15", undefined, sidecarVisit);

      expect(result.date).toBe("2024-01-20");
    });

    it("adds weather from sidecar", () => {
      const sidecarVisit = {
        weather: { temperature: -5, conditions: "Snowy" },
      };

      const result = mergeVisitSidecarMetadata("2024-01-15", undefined, sidecarVisit);

      expect(result.weather).toEqual({
        temperature: -5,
        conditions: "Snowy",
      });
    });

    it("merges weather with existing weather", () => {
      const existingWeather = { temperature: -3 };
      const sidecarVisit = {
        weather: { conditions: "Clear", humidity: 65 },
      };

      const result = mergeVisitSidecarMetadata(
        "2024-01-15",
        existingWeather,
        sidecarVisit
      );

      expect(result.weather).toEqual({
        temperature: -3,
        conditions: "Clear",
        humidity: 65,
      });
    });

    it("adds location from sidecar", () => {
      const sidecarVisit = {
        location: {
          latitude: 62.5,
          longitude: 25.7,
          name: "Central Finland",
        },
      };

      const result = mergeVisitSidecarMetadata(
        "2024-01-15",
        undefined,
        sidecarVisit
      );

      expect((result as any).location).toEqual({
        latitude: 62.5,
        longitude: 25.7,
        name: "Central Finland",
      });
    });
  });

  describe("findImageMetadataInSidecar", () => {
    it("returns undefined when no images list provided", () => {
      const result = findImageMetadataInSidecar("photo.jpg");

      expect(result).toBeUndefined();
    });

    it("returns undefined when image not found in list", () => {
      const images = [
        { filename: "other.jpg", tags: ["tag1"] },
        { filename: "another.jpg", tags: ["tag2"] },
      ];

      const result = findImageMetadataInSidecar("photo.jpg", images);

      expect(result).toBeUndefined();
    });

    it("returns metadata for matching filename", () => {
      const images = [
        { filename: "first.jpg", tags: ["landscape"] },
        {
          filename: "photo.jpg",
          captureDate: "2024-01-15T10:00:00Z",
          notes: "Found it!",
        },
        { filename: "third.jpg", tags: ["portrait"] },
      ];

      const result = findImageMetadataInSidecar("photo.jpg", images);

      expect(result).toEqual({
        filename: "photo.jpg",
        captureDate: "2024-01-15T10:00:00Z",
        notes: "Found it!",
      });
    });

    it("finds exact filename match only", () => {
      const images = [
        { filename: "photo.jpg", notes: "Exact match" },
        { filename: "photo-edit.jpg", notes: "Similar name" },
      ];

      const result = findImageMetadataInSidecar("photo.jpg", images);

      expect(result?.notes).toBe("Exact match");
    });
  });
});
