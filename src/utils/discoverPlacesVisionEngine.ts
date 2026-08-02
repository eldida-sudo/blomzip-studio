import type { Entry, ImageRecord, Visit } from "../models/blomzip";

export interface VisionPlaceCandidateGroup {
  id: string;
  imageRecordIds: string[];
  entryIds: string[];
  representativeImageRecordId: string;
  confidence: number;
  signals: string[];
}

export interface VisionNearDuplicateGroup {
  id: string;
  imageRecordIds: string[];
  entryIds: string[];
  representativeImageRecordId: string;
  confidence: number;
}

export interface VisionHeroCandidate {
  imageRecordId: string;
  entryId: string | null;
  score: number;
}

export interface VisionDiscoverySummary {
  engine: "vision-engine-v0.1-discover-places";
  analysisScope: "full-archive" | "import-batch";
  analysisImportBatchId?: string;
  analyzedImageCount: number;
  candidatePlaceGroups: VisionPlaceCandidateGroup[];
  nearDuplicateGroups: VisionNearDuplicateGroup[];
  heroCandidates: VisionHeroCandidate[];
  candidatePlaceGroupCount: number;
  nearDuplicateCount: number;
  heroCandidateCount: number;
}

interface FeatureRow {
  record: ImageRecord;
  entryId: string | null;
  pathCluster: string;
  orientationCluster: string;
  aspectBucket: number;
  megapixels: number;
  captureTimestamp: number | null;
  timelineIndex: number;
}

export interface VisionDiscoveryOptions {
  importBatchId?: string | null;
  fallbackToFullArchive?: boolean;
}

class DisjointSet {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }

    return this.parent[index];
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);

    if (leftRoot === rightRoot) {
      return;
    }

    if (this.rank[leftRoot] < this.rank[rightRoot]) {
      this.parent[leftRoot] = rightRoot;
      return;
    }

    if (this.rank[leftRoot] > this.rank[rightRoot]) {
      this.parent[rightRoot] = leftRoot;
      return;
    }

    this.parent[rightRoot] = leftRoot;
    this.rank[leftRoot] += 1;
  }

  toComponents(): number[][] {
    const byRoot = new Map<number, number[]>();

    for (let index = 0; index < this.parent.length; index += 1) {
      const root = this.find(index);
      const component = byRoot.get(root) ?? [];
      component.push(index);
      byRoot.set(root, component);
    }

    return Array.from(byRoot.values());
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toFixedScore(value: number): number {
  return Math.round(clamp(value, 0, 1) * 100) / 100;
}

function getPathCluster(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\\\/g, "/").trim();
  if (!normalized || !normalized.includes("/")) {
    return "root";
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "root";
  }

  return segments.slice(0, -1).join("/").toLowerCase();
}

function parseCaptureTimestamp(captureDate: string | undefined): number | null {
  if (!captureDate) {
    return null;
  }

  const parsed = Date.parse(captureDate);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildFeatureRows(visit: Visit, importBatchId?: string | null): FeatureRow[] {
  const imageRecords = visit.imageRecords ?? [];
  const entryByRecordId = new Map(visit.entries.map((entry) => [entry.imageRecordId, entry.id]));

  const recordsToAnalyze = importBatchId
    ? imageRecords.filter((record) => record.importBatchId === importBatchId)
    : imageRecords;

  return recordsToAnalyze.map((record, index) => {
    const width = record.width ?? 0;
    const height = record.height ?? 0;
    const aspectRatio = record.aspectRatio ?? (height > 0 ? width / height : 0);

    return {
      record,
      entryId: entryByRecordId.get(record.id) ?? null,
      pathCluster: getPathCluster(record.sourcePath),
      orientationCluster: record.orientation ?? "unknown",
      aspectBucket: Math.round(aspectRatio * 10),
      megapixels: width > 0 && height > 0 ? (width * height) / 1_000_000 : 0,
      captureTimestamp: parseCaptureTimestamp(record.captureDate),
      timelineIndex: record.timelineIndex ?? index,
    };
  });
}

function getCaptureGapMinutes(left: FeatureRow, right: FeatureRow): number | null {
  if (left.captureTimestamp === null || right.captureTimestamp === null) {
    return null;
  }

  return Math.abs(left.captureTimestamp - right.captureTimestamp) / 60_000;
}

function getTimelineGap(left: FeatureRow, right: FeatureRow): number {
  return Math.abs(left.timelineIndex - right.timelineIndex);
}

function scorePlaceSimilarity(left: FeatureRow, right: FeatureRow): number {
  let score = 0;

  if (left.pathCluster === right.pathCluster) {
    score += left.pathCluster === "root" ? 0.18 : 0.38;
  }

  if (left.orientationCluster === right.orientationCluster) {
    score += 0.12;
  }

  if (left.aspectBucket === right.aspectBucket) {
    score += 0.12;
  }

  const megapixelDelta = Math.abs(left.megapixels - right.megapixels);
  if (megapixelDelta <= 0.15) {
    score += 0.1;
  } else if (megapixelDelta <= 0.4) {
    score += 0.05;
  }

  const captureGapMinutes = getCaptureGapMinutes(left, right);
  if (captureGapMinutes !== null) {
    if (captureGapMinutes <= 15) {
      score += 0.2;
    } else if (captureGapMinutes <= 90) {
      score += 0.12;
    } else if (captureGapMinutes <= 24 * 60) {
      score += 0.05;
    }
  }

  const timelineGap = getTimelineGap(left, right);
  if (timelineGap <= 2) {
    score += 0.13;
  } else if (timelineGap <= 6) {
    score += 0.07;
  }

  return toFixedScore(score);
}

function scoreNearDuplicate(left: FeatureRow, right: FeatureRow): number {
  let score = 0;

  if (left.orientationCluster === right.orientationCluster) {
    score += 0.1;
  }

  const leftWidth = left.record.width ?? 0;
  const rightWidth = right.record.width ?? 0;
  const leftHeight = left.record.height ?? 0;
  const rightHeight = right.record.height ?? 0;

  if (leftWidth > 0 && rightWidth > 0 && leftHeight > 0 && rightHeight > 0) {
    const widthDeltaRatio = Math.abs(leftWidth - rightWidth) / Math.max(leftWidth, rightWidth);
    const heightDeltaRatio = Math.abs(leftHeight - rightHeight) / Math.max(leftHeight, rightHeight);

    if (widthDeltaRatio <= 0.01 && heightDeltaRatio <= 0.01) {
      score += 0.4;
    } else if (widthDeltaRatio <= 0.03 && heightDeltaRatio <= 0.03) {
      score += 0.2;
    }
  }

  const sizeDeltaRatio =
    Math.abs(left.record.fileSize - right.record.fileSize) / Math.max(left.record.fileSize, right.record.fileSize, 1);
  if (sizeDeltaRatio <= 0.02) {
    score += 0.25;
  } else if (sizeDeltaRatio <= 0.05) {
    score += 0.12;
  }

  const captureGapMinutes = getCaptureGapMinutes(left, right);
  if (captureGapMinutes !== null) {
    if (captureGapMinutes <= 0.5) {
      score += 0.2;
    } else if (captureGapMinutes <= 2) {
      score += 0.12;
    }
  }

  const timelineGap = getTimelineGap(left, right);
  if (timelineGap <= 1) {
    score += 0.15;
  } else if (timelineGap <= 2) {
    score += 0.08;
  }

  return toFixedScore(score);
}

function chooseRepresentative(rows: FeatureRow[]): FeatureRow {
  const sorted = [...rows].sort((left, right) => left.timelineIndex - right.timelineIndex);
  return sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
}

function buildPlaceGroupConfidence(rows: FeatureRow[]): number {
  if (rows.length <= 1) {
    return 0.5;
  }

  const pairScores: number[] = [];

  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      pairScores.push(scorePlaceSimilarity(rows[leftIndex], rows[rightIndex]));
    }
  }

  const averageSimilarity = pairScores.reduce((total, score) => total + score, 0) / Math.max(pairScores.length, 1);

  const pathCounts = new Map<string, number>();
  const orientationCounts = new Map<string, number>();
  rows.forEach((row) => {
    pathCounts.set(row.pathCluster, (pathCounts.get(row.pathCluster) ?? 0) + 1);
    orientationCounts.set(row.orientationCluster, (orientationCounts.get(row.orientationCluster) ?? 0) + 1);
  });

  const pathConsistency = Math.max(...Array.from(pathCounts.values())) / rows.length;
  const orientationConsistency = Math.max(...Array.from(orientationCounts.values())) / rows.length;

  const sortedByTimeline = [...rows].sort((left, right) => left.timelineIndex - right.timelineIndex);
  const continuitySignals = sortedByTimeline.slice(1).map((row, index) => {
    const previous = sortedByTimeline[index];
    const gap = getCaptureGapMinutes(previous, row);

    if (gap === null) {
      return 0.4;
    }

    if (gap <= 20) {
      return 1;
    }

    if (gap <= 120) {
      return 0.75;
    }

    if (gap <= 720) {
      return 0.55;
    }

    return 0.35;
  });
  const continuity = continuitySignals.length > 0
    ? continuitySignals.reduce((total, value) => total + value, 0) / continuitySignals.length
    : 0.5;

  return toFixedScore((averageSimilarity * 0.45) + (pathConsistency * 0.25) + (orientationConsistency * 0.15) + (continuity * 0.15));
}

function buildPlaceGroupSignals(rows: FeatureRow[]): string[] {
  const signals = new Set<string>(["capture sequence"]);

  const pathClusters = new Set(rows.map((row) => row.pathCluster));
  if (pathClusters.size === 1 && !pathClusters.has("root")) {
    signals.add("repeated background geometry");
    signals.add("visual similarity");
  }

  const hasOrientationAgreement = new Set(rows.map((row) => row.orientationCluster)).size <= 2;
  if (hasOrientationAgreement) {
    signals.add("camera orientation");
  }

  const hasCaptureTimestamps = rows.filter((row) => row.captureTimestamp !== null).length >= 2;
  if (hasCaptureTimestamps) {
    signals.add("EXIF timestamps");
  }

  signals.add("image similarity");

  return Array.from(signals);
}

function discoverPlaceGroups(rows: FeatureRow[]): VisionPlaceCandidateGroup[] {
  if (rows.length < 2) {
    return [];
  }

  const unionFind = new DisjointSet(rows.length);

  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const similarity = scorePlaceSimilarity(rows[leftIndex], rows[rightIndex]);
      if (similarity >= 0.58) {
        unionFind.union(leftIndex, rightIndex);
      }
    }
  }

  const groups = unionFind
    .toComponents()
    .map((indices) => indices.map((index) => rows[index]))
    .filter((groupRows) => groupRows.length >= 2)
    .sort((left, right) => right.length - left.length);

  return groups.map((groupRows, index) => {
    const representative = chooseRepresentative(groupRows);

    return {
      id: `vision-place-${index + 1}`,
      imageRecordIds: groupRows.map((row) => row.record.id),
      entryIds: groupRows
        .map((row) => row.entryId)
        .filter((entryId): entryId is string => entryId !== null),
      representativeImageRecordId: representative.record.id,
      confidence: buildPlaceGroupConfidence(groupRows),
      signals: buildPlaceGroupSignals(groupRows),
    };
  });
}

function discoverNearDuplicateGroups(rows: FeatureRow[]): VisionNearDuplicateGroup[] {
  if (rows.length < 2) {
    return [];
  }

  const unionFind = new DisjointSet(rows.length);
  const duplicateScores = new Map<string, number>();

  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const score = scoreNearDuplicate(rows[leftIndex], rows[rightIndex]);
      if (score >= 0.75) {
        unionFind.union(leftIndex, rightIndex);
        duplicateScores.set(`${leftIndex}:${rightIndex}`, score);
      }
    }
  }

  return unionFind
    .toComponents()
    .map((indices) => indices.map((index) => rows[index]))
    .filter((groupRows) => groupRows.length >= 2)
    .sort((left, right) => right.length - left.length)
    .map((groupRows, index) => {
      const representative = chooseRepresentative(groupRows);
      const indexSet = new Set(groupRows.map((row) => rows.indexOf(row)));
      const pairScores: number[] = [];

      duplicateScores.forEach((score, pairKey) => {
        const [leftIndexText, rightIndexText] = pairKey.split(":");
        const leftIndex = Number(leftIndexText);
        const rightIndex = Number(rightIndexText);

        if (indexSet.has(leftIndex) && indexSet.has(rightIndex)) {
          pairScores.push(score);
        }
      });

      const confidence = pairScores.length > 0
        ? pairScores.reduce((total, score) => total + score, 0) / pairScores.length
        : 0.75;

      return {
        id: `vision-duplicate-${index + 1}`,
        imageRecordIds: groupRows.map((row) => row.record.id),
        entryIds: groupRows
          .map((row) => row.entryId)
          .filter((entryId): entryId is string => entryId !== null),
        representativeImageRecordId: representative.record.id,
        confidence: toFixedScore(confidence),
      };
    });
}

function buildHeroScore(row: FeatureRow, entry: Entry | undefined, duplicateRecordIds: Set<string>): number {
  const aiConfidence = entry?.analysisSuggestions?.confidence ?? 0.55;
  const heroHint = entry?.analysisSuggestions?.categories.includes("hero-candidate") ? 0.12 : 0;
  const storyHint = entry?.analysisSuggestions?.categories.includes("story-candidate") ? 0.08 : 0;
  const reviewedBoost = entry?.reviewed ? 0.04 : 0;

  const megapixelScore = row.megapixels > 0
    ? clamp((row.megapixels - 1.2) / 6, 0, 1) * 0.18
    : 0;

  const orientationScore = row.orientationCluster === "landscape" ? 0.08 : row.orientationCluster === "square" ? 0.06 : 0.04;
  const duplicatePenalty = duplicateRecordIds.has(row.record.id) ? 0.18 : 0;

  return toFixedScore((aiConfidence * 0.58) + heroHint + storyHint + reviewedBoost + megapixelScore + orientationScore - duplicatePenalty);
}

function discoverHeroCandidates(rows: FeatureRow[], nearDuplicateGroups: VisionNearDuplicateGroup[], entries: Entry[]): VisionHeroCandidate[] {
  if (rows.length === 0) {
    return [];
  }

  const entryByImageRecordId = new Map(entries.map((entry) => [entry.imageRecordId, entry]));
  const duplicateRecordIds = new Set(nearDuplicateGroups.flatMap((group) => group.imageRecordIds));

  return rows
    .map((row) => {
      const entry = entryByImageRecordId.get(row.record.id);
      const score = buildHeroScore(row, entry, duplicateRecordIds);
      return {
        imageRecordId: row.record.id,
        entryId: row.entryId,
        score,
        timelineIndex: row.timelineIndex,
      };
    })
    .filter((candidate) => candidate.score >= 0.72)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.timelineIndex - right.timelineIndex;
    })
    .slice(0, 3)
    .map(({ imageRecordId, entryId, score }) => ({ imageRecordId, entryId, score }));
}

export function discoverPlacesVisionSummary(visit: Visit, options: VisionDiscoveryOptions = {}): VisionDiscoverySummary {
  const fallbackToFullArchive = options.fallbackToFullArchive ?? true;
  const requestedBatchId = options.importBatchId ?? null;

  const scopedRows = requestedBatchId ? buildFeatureRows(visit, requestedBatchId) : buildFeatureRows(visit);
  const shouldFallbackToFullArchive = requestedBatchId !== null && scopedRows.length === 0 && fallbackToFullArchive;
  const rows = shouldFallbackToFullArchive ? buildFeatureRows(visit) : scopedRows;
  const analysisScope: "full-archive" | "import-batch" = shouldFallbackToFullArchive || !requestedBatchId
    ? "full-archive"
    : "import-batch";

  if (rows.length === 0) {
    return {
      engine: "vision-engine-v0.1-discover-places",
      analysisScope,
      analysisImportBatchId: analysisScope === "import-batch" ? requestedBatchId ?? undefined : undefined,
      analyzedImageCount: 0,
      candidatePlaceGroups: [],
      nearDuplicateGroups: [],
      heroCandidates: [],
      candidatePlaceGroupCount: 0,
      nearDuplicateCount: 0,
      heroCandidateCount: 0,
    };
  }

  const candidatePlaceGroups = discoverPlaceGroups(rows);
  const nearDuplicateGroups = discoverNearDuplicateGroups(rows);
  const heroCandidates = discoverHeroCandidates(rows, nearDuplicateGroups, visit.entries);

  const nearDuplicateCount = nearDuplicateGroups.reduce(
    (total, group) => total + Math.max(group.imageRecordIds.length - 1, 0),
    0
  );

  return {
    engine: "vision-engine-v0.1-discover-places",
    analysisScope,
    analysisImportBatchId: analysisScope === "import-batch" ? requestedBatchId ?? undefined : undefined,
    analyzedImageCount: rows.length,
    candidatePlaceGroups,
    nearDuplicateGroups,
    heroCandidates,
    candidatePlaceGroupCount: candidatePlaceGroups.length,
    nearDuplicateCount,
    heroCandidateCount: heroCandidates.length,
  };
}
