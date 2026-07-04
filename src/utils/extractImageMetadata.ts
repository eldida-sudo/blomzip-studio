export type ImageOrientation = "portrait" | "landscape" | "square";

export interface ExtractedImageMetadata {
  width?: number;
  height?: number;
  aspectRatio?: number;
  orientation?: ImageOrientation;
  captureDate?: string;
  mimeType?: string;
}

function getExtension(fileName: string) {
  const normalizedName = fileName.toLowerCase();
  const lastDotIndex = normalizedName.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return "";
  }

  return normalizedName.slice(lastDotIndex + 1);
}

function readUInt16BE(data: Uint8Array, offset: number) {
  if (offset + 1 >= data.length) {
    return undefined;
  }

  return (data[offset] << 8) | data[offset + 1];
}

function readUInt32BE(data: Uint8Array, offset: number) {
  const first = readUInt16BE(data, offset);
  const second = readUInt16BE(data, offset + 2);

  if (first === undefined || second === undefined) {
    return undefined;
  }

  return (first << 16) | second;
}

function inferMimeType(data: Uint8Array, fileName: string) {
  const extension = getExtension(fileName);

  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      break;
  }

  if (data.length >= 8) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      return "image/png";
    }

    if (data[0] === 0xff && data[1] === 0xd8) {
      return "image/jpeg";
    }

    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
      return "image/webp";
    }
  }

  return undefined;
}

function findCaptureDate(data: Uint8Array) {
  const decoder = new TextDecoder("ascii", { fatal: false });
  const text = decoder.decode(data);
  const match = text.match(/(\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2})/);

  return match?.[1];
}

function extractJpegMetadata(data: Uint8Array) {
  const metadata: ExtractedImageMetadata = {};

  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return metadata;
  }

  let index = 2;

  while (index + 1 < data.length) {
    if (data[index] !== 0xff) {
      index += 1;
      continue;
    }

    const marker = data[index + 1];

    if (marker === 0x00 || marker === 0xff) {
      index += 1;
      continue;
    }

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (marker >= 0xd0 && marker <= 0xd7) {
      index += 2;
      continue;
    }

    if (index + 4 >= data.length) {
      break;
    }

    const segmentLength = (data[index + 2] << 8) | data[index + 3];
    const segmentStart = index + 4;
    const segmentEnd = segmentStart + segmentLength - 2;

    if (segmentEnd > data.length) {
      break;
    }

    if (marker === 0xc0 || marker === 0xc2 || marker === 0xc3 || marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 || marker === 0xca || marker === 0xcb || marker === 0xcd || marker === 0xce || marker === 0xcf) {
      if (segmentStart + 4 < data.length) {
        metadata.height = (data[segmentStart + 1] << 8) | data[segmentStart + 2];
        metadata.width = (data[segmentStart + 3] << 8) | data[segmentStart + 4];
      }
      index = segmentEnd;
      continue;
    }

    if (marker === 0xe1) {
      metadata.captureDate = findCaptureDate(data.slice(segmentStart, segmentEnd));
    }

    index = segmentEnd;
  }

  metadata.captureDate ??= findCaptureDate(data);

  return metadata;
}

function extractPngMetadata(data: Uint8Array) {
  const metadata: ExtractedImageMetadata = {};

  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return metadata;
  }

  metadata.width = readUInt32BE(data, 16);
  metadata.height = readUInt32BE(data, 20);

  return metadata;
}

function extractWebpMetadata(data: Uint8Array) {
  const metadata: ExtractedImageMetadata = {};

  if (data.length < 30 || data[0] !== 0x52 || data[1] !== 0x49 || data[2] !== 0x46 || data[3] !== 0x46) {
    return metadata;
  }

  const signature = new TextDecoder("ascii", { fatal: false }).decode(data.slice(8, 12));

  if (signature === "WEBP") {
    const chunkType = new TextDecoder("ascii", { fatal: false }).decode(data.slice(12, 16));

    if (chunkType === "VP8X") {
      metadata.width = 1 + readUInt24LE(data, 24);
      metadata.height = 1 + readUInt24LE(data, 27);
    }
  }

  return metadata;
}

function readUInt24LE(data: Uint8Array, offset: number) {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function buildOrientation(width?: number, height?: number): ExtractedImageMetadata["orientation"] {
  if (width === undefined || height === undefined) {
    return undefined;
  }

  if (width === height) {
    return "square";
  }

  return width > height ? "landscape" : "portrait";
}

export function extractImageMetadata(data: Uint8Array, fileName: string): ExtractedImageMetadata {
  const mimeType = inferMimeType(data, fileName);
  const extension = getExtension(fileName).toLowerCase();

  let extracted: ExtractedImageMetadata = {};

  if (extension === "png" || mimeType === "image/png") {
    extracted = extractPngMetadata(data);
  } else if (extension === "webp" || mimeType === "image/webp") {
    extracted = extractWebpMetadata(data);
  } else {
    extracted = extractJpegMetadata(data);
  }

  if (mimeType) {
    extracted.mimeType = mimeType;
  }

  if (extracted.width !== undefined && extracted.height !== undefined) {
    extracted.aspectRatio = Number((extracted.width / extracted.height).toFixed(4));
    extracted.orientation = buildOrientation(extracted.width, extracted.height);
  }

  return extracted;
}
