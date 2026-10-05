export const ANALYSIS_IMAGE_MAX_EDGE = 1600;
const ANALYSIS_IMAGE_QUALITY = 0.85;

export interface AnalysisImage {
  blob: Blob;
  width: number;
  height: number;
}

export function computeAnalysisSize(
  width: number,
  height: number,
  maxEdge: number = ANALYSIS_IMAGE_MAX_EDGE
): { width: number; height: number } {
  const longEdge = Math.max(width, height);

  if (longEdge <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function decodeImage(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not decode image."));
    image.src = url;
  });

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

/** Resizes to at most 1600px on the long edge and re-encodes as JPEG for Vision analysis. */
export async function createAnalysisImage(blob: Blob): Promise<AnalysisImage> {
  const decoded = await decodeImage(blob);

  try {
    if (!decoded.width || !decoded.height) {
      throw new Error("Image has no readable dimensions.");
    }

    const size = computeAnalysisSize(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare image for analysis.");
    }

    // PNG transparency would otherwise turn black in JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(decoded.source, 0, 0, size.width, size.height);

    const output = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", ANALYSIS_IMAGE_QUALITY)
    );

    if (!output) {
      throw new Error("Could not encode image for analysis.");
    }

    return { blob: output, width: size.width, height: size.height };
  } finally {
    decoded.release();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image data."));
    reader.onerror = () => reject(new Error("Could not read image data."));
    reader.readAsDataURL(blob);
  });
}

export async function imageUrlToBlob(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Could not read image: ${response.status}`);
  }

  return await response.blob();
}
