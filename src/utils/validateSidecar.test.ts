import { describe, expect, it } from "vitest";
import { type ImportSidecarV1 } from "../models/importSidecar";
import { validateSidecar } from "./validateSidecar";

describe("validateSidecar", () => {
  const baseValidSidecar: ImportSidecarV1 = {
    version: "1.0",
  };

  it("accepts minimal valid sidecar", () => {
    const result = validateSidecar(baseValidSidecar, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("detects invalid version", () => {
    const sidecar = { ...baseValidSidecar, version: "2.0" } as ImportSidecarV1;

    const result = validateSidecar(sidecar, []);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toContain("version");
  });

  describe("visit metadata validation", () => {
    it("accepts valid visit date", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: { date: "2024-01-15" },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(true);
    });

    it("warns on invalid ISO 8601 date", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: { date: "2024-13-45" }, // Invalid month and day
      };

      const result = validateSidecar(sidecar, []);

      // Invalid dates are warnings, not errors - import can still proceed
      expect(result.valid).toBe(true); // Still valid with warnings
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].path).toContain("date");
    });

    it("rejects non-string date", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: { date: 12345 as unknown as string },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it("accepts valid location with GPS coordinates", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: {
          location: {
            latitude: 60.1699,
            longitude: 24.9384,
            name: "Helsinki",
            elevation: 10,
          },
        },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(true);
    });

    it("rejects invalid latitude", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: {
          location: { latitude: 95, longitude: 0 },
        },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("latitude");
    });

    it("rejects invalid longitude", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: {
          location: { latitude: 0, longitude: 200 },
        },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("longitude");
    });

    it("accepts valid weather data", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: {
          weather: {
            temperature: -5,
            conditions: "Snowy",
            humidity: 75,
            windSpeed: 3.5,
          },
        },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(true);
    });

    it("rejects humidity outside 0-100", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: { weather: { humidity: 150 } },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("humidity");
    });

    it("rejects negative wind speed", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: { weather: { windSpeed: -5 } },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("wind speed");
    });
  });

  describe("image metadata validation", () => {
    it("rejects image without filename", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [{ filename: "" } as any],
      };

      const result = validateSidecar(sidecar, ["image1.jpg"]);

      // Should be invalid - empty filename is not allowed
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("empty");
    });

    it("warns when image filename not found in zip", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [{ filename: "missing.jpg" }],
      };

      const result = validateSidecar(sidecar, ["exists.jpg"]);

      expect(result.valid).toBe(true); // Still valid - warning only
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toContain("not found");
    });

    it("accepts image with valid capture date", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [
          {
            filename: "image.jpg",
            captureDate: "2024-01-15T14:30:00Z",
          },
        ],
      };

      const result = validateSidecar(sidecar, ["image.jpg"]);

      expect(result.valid).toBe(true);
    });

    it("warns on invalid capture date format", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [
          {
            filename: "image.jpg",
            captureDate: "not-a-date",
          },
        ],
      };

      const result = validateSidecar(sidecar, ["image.jpg"]);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].path).toContain("captureDate");
    });

    it("accepts valid image dimensions", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [
          {
            filename: "image.jpg",
            dimensions: { width: 4000, height: 3000 },
          },
        ],
      };

      const result = validateSidecar(sidecar, ["image.jpg"]);

      expect(result.valid).toBe(true);
    });

    it("rejects non-positive dimensions", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [
          {
            filename: "image.jpg",
            dimensions: { width: 0, height: 3000 },
          },
        ],
      };

      const result = validateSidecar(sidecar, ["image.jpg"]);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("positive");
    });

    it("accepts image with tags", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [
          {
            filename: "image.jpg",
            tags: ["forest", "snow", "wildlife"],
          },
        ],
      };

      const result = validateSidecar(sidecar, ["image.jpg"]);

      expect(result.valid).toBe(true);
    });

    it("rejects non-string tags", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [
          {
            filename: "image.jpg",
            tags: ["valid", 123] as any,
          },
        ],
      };

      const result = validateSidecar(sidecar, ["image.jpg"]);

      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toContain("tags");
    });

    it("accepts custom metadata with string/number/boolean values", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [
          {
            filename: "image.jpg",
            custom: {
              species: "Pine",
              count: 42,
              verified: true,
            },
          },
        ],
      };

      const result = validateSidecar(sidecar, ["image.jpg"]);

      expect(result.valid).toBe(true);
    });

    it("rejects custom metadata with non-scalar values", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        images: [
          {
            filename: "image.jpg",
            custom: {
              valid: "ok",
              invalid: {},
            } as any,
          },
        ],
      };

      const result = validateSidecar(sidecar, ["image.jpg"]);

      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toContain("custom");
    });
  });

  describe("settings validation", () => {
    it("accepts valid timezone string", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        settings: { timezone: "Europe/Helsinki" },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(true);
    });

    it("rejects non-string timezone", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        settings: { timezone: 123 } as any,
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toContain("timezone");
    });

    it("accepts valid lenient boolean", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        settings: { lenient: true },
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(true);
    });

    it("rejects non-boolean lenient", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        settings: { lenient: "yes" } as any,
      };

      const result = validateSidecar(sidecar, []);

      expect(result.valid).toBe(false);
    });
  });

  describe("comprehensive validation scenarios", () => {
    it("validates complete sidecar with all features", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: {
          date: "2024-01-15",
          name: "Winter Forest",
          location: {
            latitude: 62.5,
            longitude: 25.7,
            name: "Central Finland",
            elevation: 180,
          },
          weather: {
            temperature: -8,
            conditions: "Clear",
            humidity: 60,
            windSpeed: 2,
          },
          notes: "Beautiful winter day",
        },
        images: [
          {
            filename: "landscape.jpg",
            captureDate: "2024-01-15T10:00:00Z",
            dimensions: { width: 5000, height: 3333 },
            location: { latitude: 62.5, longitude: 25.7 },
            notes: "Wide angle landscape",
            tags: ["landscape", "winter"],
            custom: {
              fstop: "5.6",
              iso: 200,
              featured: true,
            },
          },
          {
            filename: "detail.jpg",
            captureDate: "2024-01-15T11:30:00Z",
            tags: ["macro", "frost"],
          },
        ],
        settings: {
          timezone: "Europe/Helsinki",
          lenient: false,
        },
      };

      const result = validateSidecar(sidecar, ["landscape.jpg", "detail.jpg"]);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("collects multiple errors and warnings", () => {
      const sidecar: ImportSidecarV1 = {
        version: "1.0",
        visit: {
          date: "invalid-date",
          location: {
            latitude: 150, // Out of range
            longitude: 250, // Out of range
          },
        },
        images: [
          {
            filename: "missing.jpg",
            captureDate: "bad-date",
            dimensions: { width: -1, height: 0 }, // Both invalid
            tags: [123] as any, // Non-string tag
          },
        ],
      };

      const result = validateSidecar(sidecar, ["exists.jpg"]);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
