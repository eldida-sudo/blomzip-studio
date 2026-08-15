import { type Visit } from "../models/blomzip";
import { createTemporaryVisitFromZip } from "./createTemporaryVisitFromZip";
import { readZipImages, type ZipImportSummary } from "./readZipImages";

export interface ImportSingleZipResult {
  status: "success" | "failed";
  summary: ZipImportSummary;
  visit: Visit | null;
  errorMessage?: string;
}

/**
 * Reusable single-ZIP import pipeline: ZIP reading, metadata/EXIF extraction,
 * sidecar handling and temporary visit creation. Both the single-ZIP and
 * multi-ZIP queue flows call this so there is only one import implementation.
 */
export async function importSingleZip(file: Pick<File, "name" | "arrayBuffer">): Promise<ImportSingleZipResult> {
  const summary = await readZipImages(file);

  if (summary.status === "invalid") {
    return {
      status: "failed",
      summary,
      visit: null,
      errorMessage: summary.errorMessage ?? "The selected file could not be read as a ZIP archive.",
    };
  }

  const visit = createTemporaryVisitFromZip(summary);

  return {
    status: "success",
    summary,
    visit,
  };
}
