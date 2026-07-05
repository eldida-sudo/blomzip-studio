import JSZip from "jszip";
import { type ImportSidecarV1, type SidecarValidationError, isImportSidecarV1 } from "../models/importSidecar";

export interface ParseSidecarResult {
  sidecar: ImportSidecarV1 | null;
  found: boolean;
  errors: SidecarValidationError[];
  filename?: string;
}

// Filenames to check for sidecar, in priority order
const SIDECAR_FILENAMES = ["blomzip.json", "sidecar.json", "metadata.json"];

/**
 * Searches for and parses an Import Sidecar JSON from a ZIP archive.
 * 
 * Returns null if no sidecar is found (ZIP can work without it).
 * Returns parse errors if sidecar is found but invalid.
 * 
 * @param zip JSZip instance to search
 * @returns ParseSidecarResult with sidecar data, location, and any errors
 */
export async function parseSidecarFromZip(zip: JSZip): Promise<ParseSidecarResult> {
  const errors: SidecarValidationError[] = [];

  // Find sidecar file by name
  let sidecarFile: JSZip.JSZipObject | null = null;
  let foundFilename: string | undefined;

  for (const filename of SIDECAR_FILENAMES) {
    const candidate = zip.files[filename];
    if (candidate && !candidate.dir) {
      sidecarFile = candidate;
      foundFilename = filename;
      break;
    }
  }

  if (!sidecarFile) {
    return { sidecar: null, found: false, errors: [] };
  }

  // Read sidecar file content
  let content: string;
  try {
    content = await sidecarFile.async("text");
  } catch (error) {
    errors.push({
      path: foundFilename,
      message: `Failed to read sidecar file: ${error instanceof Error ? error.message : "Unknown error"}`,
      severity: "error",
    });
    return { sidecar: null, found: true, errors, filename: foundFilename };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    errors.push({
      path: foundFilename,
      message: `Invalid JSON: ${error instanceof Error ? error.message : "JSON parsing failed"}`,
      severity: "error",
    });
    return { sidecar: null, found: true, errors, filename: foundFilename };
  }

  // Validate structure
  if (!isImportSidecarV1(parsed)) {
    errors.push({
      path: `${foundFilename}.version`,
      message: `Missing or invalid version field. Expected "1.0", got "${(parsed as Record<string, unknown>).version}"`,
      severity: "error",
    });
    return { sidecar: null, found: true, errors, filename: foundFilename };
  }

  return { sidecar: parsed, found: true, errors, filename: foundFilename };
}
