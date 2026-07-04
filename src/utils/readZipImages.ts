import JSZip from "jszip";

export type ZipImportStatus = "ready" | "empty" | "invalid";

export interface ZipImageEntry {
  filename: string;
  fileSize: number;
  data: Uint8Array;
}

export interface ZipImportSummary {
  fileName: string;
  status: ZipImportStatus;
  imageCount: number;
  totalImageSize: number;
  imageFiles: string[];
  imageEntries?: ZipImageEntry[];
  errorMessage?: string;
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

function getExtension(fileName: string) {
  const normalizedName = fileName.toLowerCase();
  const lastDotIndex = normalizedName.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return "";
  }

  return normalizedName.slice(lastDotIndex + 1);
}

function isSupportedImage(fileName: string) {
  const extension = getExtension(fileName);
  return SUPPORTED_IMAGE_EXTENSIONS.has(extension);
}

export async function readZipImages(file: Pick<File, "name" | "arrayBuffer">): Promise<ZipImportSummary> {
  try {
    const archiveBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(archiveBuffer);
    const archiveEntries = Object.values(zip.files);
    const imageEntries = archiveEntries.filter((entry) => !entry.dir && isSupportedImage(entry.name));

    if (archiveEntries.length === 0 || archiveEntries.every((entry) => entry.dir)) {
      return {
        fileName: file.name,
        status: "empty",
        imageCount: 0,
        totalImageSize: 0,
        imageFiles: [],
      };
    }

    if (imageEntries.length === 0) {
      return {
        fileName: file.name,
        status: "ready",
        imageCount: 0,
        totalImageSize: 0,
        imageFiles: [],
      };
    }

    const imageFiles: string[] = [];
    const imageEntriesData: ZipImageEntry[] = [];
    let totalImageSize = 0;

    for (const entry of imageEntries) {
      const data = await entry.async("uint8array");
      const filename = entry.name.split("/").pop() ?? entry.name;
      totalImageSize += data.byteLength;
      imageFiles.push(filename);
      imageEntriesData.push({ filename, fileSize: data.byteLength, data });
    }

    return {
      fileName: file.name,
      status: "ready",
      imageCount: imageFiles.length,
      totalImageSize,
      imageFiles,
      imageEntries: imageEntriesData,
    };
  } catch (error) {
    return {
      fileName: file.name,
      status: "invalid",
      imageCount: 0,
      totalImageSize: 0,
      imageFiles: [],
      errorMessage: error instanceof Error ? error.message : "The selected file could not be read as a ZIP archive.",
    };
  }
}
