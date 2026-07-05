import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseSidecarFromZip } from "./parseSidecarFromZip";

describe("parseSidecarFromZip", () => {
  it("returns null when no sidecar file exists", async () => {
    const zip = new JSZip();
    zip.file("image.jpg", Uint8Array.from([1, 2, 3]));

    const result = await parseSidecarFromZip(zip);

    expect(result.found).toBe(false);
    expect(result.sidecar).toBeNull();
    expect(result.errors).toEqual([]);
  });

  it("finds and parses blomzip.json as primary sidecar", async () => {
    const zip = new JSZip();
    const sidecarData = {
      version: "1.0",
      visit: {
        date: "2024-01-15",
        name: "Forest Visit",
      },
    };
    zip.file("blomzip.json", JSON.stringify(sidecarData));

    const result = await parseSidecarFromZip(zip);

    expect(result.found).toBe(true);
    expect(result.filename).toBe("blomzip.json");
    expect(result.sidecar).toEqual(sidecarData);
    expect(result.errors).toEqual([]);
  });

  it("finds sidecar.json if blomzip.json not present", async () => {
    const zip = new JSZip();
    const sidecarData = {
      version: "1.0",
      visit: { notes: "Test notes" },
    };
    zip.file("sidecar.json", JSON.stringify(sidecarData));

    const result = await parseSidecarFromZip(zip);

    expect(result.found).toBe(true);
    expect(result.filename).toBe("sidecar.json");
    expect(result.sidecar).toEqual(sidecarData);
  });

  it("prefers blomzip.json over sidecar.json when both exist", async () => {
    const zip = new JSZip();
    zip.file("blomzip.json", JSON.stringify({ version: "1.0", visit: { name: "First" } }));
    zip.file("sidecar.json", JSON.stringify({ version: "1.0", visit: { name: "Second" } }));

    const result = await parseSidecarFromZip(zip);

    expect(result.filename).toBe("blomzip.json");
    expect(result.sidecar?.visit?.name).toBe("First");
  });

  it("reports error when sidecar JSON is invalid", async () => {
    const zip = new JSZip();
    zip.file("blomzip.json", "{invalid json}");

    const result = await parseSidecarFromZip(zip);

    expect(result.found).toBe(true);
    expect(result.sidecar).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].severity).toBe("error");
    expect(result.errors[0].message).toContain("Invalid JSON");
  });

  it("reports error when version is missing or wrong", async () => {
    const zip = new JSZip();
    zip.file("blomzip.json", JSON.stringify({ visit: { name: "No version" } }));

    const result = await parseSidecarFromZip(zip);

    expect(result.found).toBe(true);
    expect(result.sidecar).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe("blomzip.json.version");
  });

  it("parses sidecar with complete visit and image metadata", async () => {
    const zip = new JSZip();
    const sidecarData = {
      version: "1.0",
      visit: {
        date: "2024-01-15T14:30:00Z",
        name: "Mountain Visit",
        location: {
          latitude: 60.3,
          longitude: 24.9,
          name: "Nuuksio, Finland",
          elevation: 150,
        },
        weather: {
          temperature: -2,
          conditions: "Snowy",
          humidity: 85,
        },
        notes: "Great day for photography",
      },
      images: [
        {
          filename: "forest1.jpg",
          captureDate: "2024-01-15T14:30:00Z",
          dimensions: { width: 4000, height: 3000 },
          tags: ["forest", "snow"],
        },
        {
          filename: "forest2.jpg",
          location: { latitude: 60.31, longitude: 24.91 },
          notes: "Close-up of frost",
        },
      ],
      settings: {
        timezone: "Europe/Helsinki",
        lenient: false,
      },
    };
    zip.file("blomzip.json", JSON.stringify(sidecarData));

    const result = await parseSidecarFromZip(zip);

    expect(result.found).toBe(true);
    expect(result.sidecar).toEqual(sidecarData);
    expect(result.sidecar?.images).toHaveLength(2);
    expect(result.sidecar?.visit?.location?.latitude).toBe(60.3);
  });

  it("parses minimal valid sidecar with only version", async () => {
    const zip = new JSZip();
    const sidecarData = {
      version: "1.0",
    };
    zip.file("blomzip.json", JSON.stringify(sidecarData));

    const result = await parseSidecarFromZip(zip);

    expect(result.found).toBe(true);
    expect(result.sidecar).toEqual(sidecarData);
    expect(result.errors).toEqual([]);
  });

  it("ignores sidecar files in subdirectories", async () => {
    const zip = new JSZip();
    zip.file("data/blomzip.json", JSON.stringify({ version: "1.0" }));

    const result = await parseSidecarFromZip(zip);

    // Should not find it because we only check root level
    expect(result.found).toBe(false);
  });
});
