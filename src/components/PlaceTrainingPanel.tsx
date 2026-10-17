import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { PreviewThumbnailButton, useImagePreview } from "./ImagePreviewLightbox";
import { getPlaceById, listCanonicalPlaces, type CanonicalPlace } from "../data/canonicalPlaces";
import type {
  ImageRecord,
  PlaceMatchResult,
  PlaceTrainingState,
  PlaceVisualAnchor,
  Visit,
} from "../models/blomzip";
import { blobToDataUrl, createAnalysisImage, imageUrlToBlob } from "../utils/analysisImage";
import { createThumbnailUrlForRecord } from "../utils/createThumbnailUrls";
import { resolvePlaceSignature } from "../utils/placeSignatureCache";
import { isRecordEligibleNow } from "../utils/externalClassification";
import { isPlaceDetailRecord } from "../utils/placeDetail";
import { createAnchorImageBackup, importAnchorImageBackup } from "../utils/placeAnchorBackup";
import { getAnchorImages, putAnchorImage, type StoredAnchorImage } from "../utils/placeAnchorStore";
import {
  addPlaceAnchors,
  countRemainingCandidates,
  countReevaluationCandidates,
  createMatchResultId,
  getMatchConfidence,
  getMatchingReadiness,
  MATCH_CONFIDENCE_LABELS,
  getPlaceAnchors,
  isAcceptedAnchorFile,
  listArchiveAnchorCandidates,
  validateArchiveAnchorSelection,
  listReevaluationComparisons,
  listNearbyContextMatches,
  listPendingMatches,
  MAX_MATCH_CANDIDATES_PER_RUN,
  MAX_REEVALUATION_CANDIDATES_PER_RUN,
  MAX_PLACE_ANCHORS,
  MIN_PLACE_ANCHORS,
  PLACE_DETAIL_ANCHOR_MESSAGE,
  removePlaceAnchor,
  replacePlaceAnchor,
  selectMatchCandidates,
  selectReevaluationCandidates,
  saveReevaluatedMatch,
  upsertMatchResult,
} from "../utils/placeTraining";
import type { VisionProvider } from "../utils/visionProvider";

interface PlaceTrainingPanelProps {
  place: CanonicalPlace;
  visit: Visit | null;
  training: PlaceTrainingState;
  getTraining: () => PlaceTrainingState;
  onTrainingChange: (updater: (current: PlaceTrainingState) => PlaceTrainingState) => void;
  onApproveMatch: (resultId: string) => string | null;
  onReassignMatch: (resultId: string, targetPlaceId: string) => string | null;
  onMarkUnsure: (resultId: string) => void;
  onUndoReview: (resultId: string) => string | null;
  visionProvider: VisionProvider;
}

function createAnchorId(): string {
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `anchor-${unique}`;
}

function percent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function PlaceTrainingPanel({
  place,
  visit,
  training,
  getTraining,
  onTrainingChange,
  onApproveMatch,
  onReassignMatch,
  onMarkUnsure,
  onUndoReview,
  visionProvider,
}: PlaceTrainingPanelProps) {
  const anchors = getPlaceAnchors(training, place.id);
  const { open: openImagePreview, lightbox: imagePreviewLightbox } = useImagePreview();
  const [anchorImages, setAnchorImages] = useState<Map<string, StoredAnchorImage>>(new Map());
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [undoResultId, setUndoResultId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [anchorReloadCount, setAnchorReloadCount] = useState(0);
  const [backupStatus, setBackupStatus] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [isPickingFromArchive, setIsPickingFromArchive] = useState(false);
  const [pickedRecordIds, setPickedRecordIds] = useState<string[]>([]);
  const [isMatching, setIsMatching] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reevaluationSummary, setReevaluationSummary] = useState<{
    changed: number;
    same: number;
    failures: number;
    engineVersion: string | null;
    stopped: boolean;
    resultIds: string[];
  } | null>(null);
  const previewUrlsRef = useRef<Map<string, string>>(new Map());
  const cancelRef = useRef(false);
  const visitRef = useRef(visit);
  visitRef.current = visit;
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);

  const anchorIdKey = anchors.map((anchor) => anchor.id).join("|");

  useEffect(() => {
    let cancelled = false;
    const ids = anchorIdKey ? anchorIdKey.split("|") : [];

    void getAnchorImages(ids).then((images) => {
      if (cancelled) {
        return;
      }

      const urls = new Map<string, string>();
      images.forEach((image, id) => urls.set(id, URL.createObjectURL(image.blob)));
      setAnchorImages(images);
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = urls;
      setPreviewUrls(urls);
    });

    return () => {
      cancelled = true;
    };
  }, [anchorIdKey, anchorReloadCount]);

  useEffect(
    () => () => {
      cancelRef.current = true;
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = new Map();
    },
    []
  );

  const usableAnchors = anchors.filter((anchor) => anchorImages.has(anchor.id));
  const readiness = getMatchingReadiness(usableAnchors.length);
  const pendingMatches = listPendingMatches(visit, place.id, training);
  const nearbyMatches = listNearbyContextMatches(visit, place.id, training);
  const remainingCandidates = countRemainingCandidates(visit, place.id, training);
  const reevaluationCandidateCount = countReevaluationCandidates(visit, place.id, training);
  const reevaluationComparisons = reevaluationSummary
    ? listReevaluationComparisons(visit, training, reevaluationSummary.resultIds)
    : [];
  const archiveCandidates = isPickingFromArchive ? listArchiveAnchorCandidates(visit, training, place.id) : [];
  const recordsById = new Map<string, ImageRecord>((visit?.imageRecords ?? []).map((record) => [record.id, record]));
  const promotableApproved = training.matchResults.filter(
    (result) =>
      result.placeId === place.id &&
      result.status === "approved" &&
      recordsById.get(result.imageRecordId)?.placeId === place.id &&
      !isPlaceDetailRecord(recordsById.get(result.imageRecordId)) &&
      !anchors.some((anchor) => anchor.sourceImageRecordId === result.imageRecordId)
  );

  async function createStoredAnchor(
    source: Blob,
    meta: { filename: string; source: PlaceVisualAnchor["source"]; sourceImageRecordId?: string }
  ): Promise<PlaceVisualAnchor> {
    const analysisImage = await createAnalysisImage(source);
    const anchor: PlaceVisualAnchor = {
      id: createAnchorId(),
      placeId: place.id,
      filename: meta.filename,
      mimeType: "image/jpeg",
      createdAt: new Date().toISOString(),
      width: analysisImage.width,
      height: analysisImage.height,
      source: meta.source,
      sourceImageRecordId: meta.sourceImageRecordId,
    };

    await putAnchorImage({
      anchorId: anchor.id,
      placeId: place.id,
      blob: analysisImage.blob,
      mimeType: anchor.mimeType,
      width: analysisImage.width,
      height: analysisImage.height,
    });

    return anchor;
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const files = Array.from(input.files ?? []);
    input.value = "";

    if (files.length === 0) {
      return;
    }

    const rejected = files.filter((file) => !isAcceptedAnchorFile(file));
    if (rejected.length > 0) {
      setMessage({ tone: "error", text: `Only JPG and PNG images can be used as visual anchors. Nothing was added.` });
      return;
    }

    const remaining = MAX_PLACE_ANCHORS - anchors.length;
    if (files.length > remaining) {
      setMessage({
        tone: "error",
        text:
          remaining <= 0
            ? `This place already has the maximum of ${MAX_PLACE_ANCHORS} visual anchors. Remove one first.`
            : `Only ${remaining} more visual ${remaining === 1 ? "anchor fits" : "anchors fit"} (maximum ${MAX_PLACE_ANCHORS}). Nothing was added.`,
      });
      return;
    }

    setIsBusy(true);
    setMessage(null);

    try {
      const created: PlaceVisualAnchor[] = [];
      for (const file of files) {
        created.push(await createStoredAnchor(file, { filename: file.name, source: "upload" }));
      }

      const result = addPlaceAnchors(getTraining(), place.id, created);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }

      onTrainingChange((current) => {
        const next = addPlaceAnchors(current, place.id, created);
        return next.ok ? next.value : current;
      });
      setMessage({ tone: "info", text: `Added ${created.length} visual ${created.length === 1 ? "anchor" : "anchors"}.` });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? `Could not add the image: ${error.message}` : "Could not add the image.",
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReplaceSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    const targetId = replaceTargetRef.current;
    input.value = "";

    if (!file || !targetId) {
      return;
    }

    if (!isAcceptedAnchorFile(file)) {
      setMessage({ tone: "error", text: "Only JPG and PNG images can be used as visual anchors." });
      return;
    }

    setIsBusy(true);
    setMessage(null);

    try {
      const replacement = await createStoredAnchor(file, { filename: file.name, source: "upload" });
      onTrainingChange((current) => {
        const next = replacePlaceAnchor(current, place.id, targetId, replacement);
        return next.ok ? next.value : current;
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? `Could not replace the image: ${error.message}` : "Could not replace the image.",
      });
    } finally {
      setIsBusy(false);
    }
  }

  function handleRemove(anchorId: string) {
    // Metadata only: the stored image bytes are kept so safety snapshots can still restore them.
    onTrainingChange((current) => removePlaceAnchor(current, place.id, anchorId));
  }

  async function handlePromote(result: PlaceMatchResult) {
    const record = recordsById.get(result.imageRecordId);
    const url = record ? createThumbnailUrlForRecord(record) : undefined;

    if (!record || !url) {
      return;
    }

    if (isPlaceDetailRecord(record)) {
      setMessage({ tone: "error", text: PLACE_DETAIL_ANCHOR_MESSAGE });
      return;
    }

    setIsBusy(true);
    setMessage(null);

    try {
      const anchor = await createStoredAnchor(await imageUrlToBlob(url), {
        filename: record.filename,
        source: "archive-photo",
        sourceImageRecordId: record.id,
      });

      onTrainingChange((current) => {
        const next = addPlaceAnchors(current, place.id, [anchor]);
        return next.ok ? next.value : current;
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? `Could not add the visual anchor: ${error.message}` : "Could not add the visual anchor.",
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmArchiveAnchors() {
    const selection = validateArchiveAnchorSelection(visit, getTraining(), place.id, pickedRecordIds);

    if (!selection.ok) {
      setMessage({ tone: "error", text: selection.error });
      return;
    }

    setIsBusy(true);
    setMessage(null);

    try {
      // Image bytes are stored before the metadata is committed, so a failure leaves no dangling anchor.
      const created: PlaceVisualAnchor[] = [];
      for (const record of selection.value) {
        created.push(
          await createStoredAnchor(await imageUrlToBlob(createThumbnailUrlForRecord(record) as string), {
            filename: record.filename,
            source: "archive-photo",
            sourceImageRecordId: record.id,
          })
        );
      }

      const added = addPlaceAnchors(getTraining(), place.id, created);
      if (!added.ok) {
        setMessage({ tone: "error", text: added.error });
        return;
      }

      onTrainingChange((current) => {
        const next = addPlaceAnchors(current, place.id, created);
        return next.ok ? next.value : current;
      });
      setPickedRecordIds([]);
      setIsPickingFromArchive(false);
      setMessage({ tone: "info", text: `Added ${created.length} visual ${created.length === 1 ? "anchor" : "anchors"} from the archive.` });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? `Could not add the visual anchors: ${error.message}` : "Could not add the visual anchors.",
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleFindMatches() {
    const matchFn = visionProvider.matchPlaceCandidate?.bind(visionProvider);
    const signatureFn = visionProvider.derivePlaceSignature?.bind(visionProvider);

    if (!matchFn || !signatureFn) {
      setMessage({ tone: "error", text: "The configured Vision provider cannot compare photographs to a place." });
      return;
    }

    const currentAnchors = getPlaceAnchors(getTraining(), place.id).filter((anchor) => anchorImages.has(anchor.id));
    if (!getMatchingReadiness(currentAnchors.length).ready) {
      return;
    }

    const candidates = selectMatchCandidates(visit, place.id, getTraining(), MAX_MATCH_CANDIDATES_PER_RUN);
    if (candidates.length === 0) {
      setMessage({ tone: "info", text: "There are no unassigned photographs left to compare for this place." });
      return;
    }

    cancelRef.current = false;
    setIsMatching(true);
    setMessage(null);
    setProgress({ done: 0, total: candidates.length });

    let failures = 0;
    let consecutiveFailures = 0;
    let lastError = "";

    try {
      const { signature, anchorDataUrls } = await resolvePlaceSignature({
        provider: visionProvider,
        placeId: place.id,
        placeName: place.displayName,
        anchors: currentAnchors.map((anchor) => ({ id: anchor.id, blob: (anchorImages.get(anchor.id) as StoredAnchorImage).blob })),
        getTraining,
        commit: onTrainingChange,
      });

      for (const [index, record] of candidates.entries()) {
        if (cancelRef.current) {
          break;
        }

        if (!isRecordEligibleNow(visitRef.current, record.id)) {
          setProgress({ done: index + 1, total: candidates.length });
          continue;
        }

        try {
          const url = createThumbnailUrlForRecord(record) as string;
          const analysisImage = await createAnalysisImage(await imageUrlToBlob(url));
          const candidateImageDataUrl = await blobToDataUrl(analysisImage.blob);

          if (!isRecordEligibleNow(visitRef.current, record.id)) {
            setProgress({ done: index + 1, total: candidates.length });
            continue;
          }

          const outcome = await matchFn({
            placeId: place.id,
            placeName: place.displayName,
            imageRecordId: record.id,
            candidateImageDataUrl,
            anchorImageDataUrls: anchorDataUrls,
            signature,
          });

          if (!isRecordEligibleNow(visitRef.current, record.id)) {
            setProgress({ done: index + 1, total: candidates.length });
            continue;
          }

          onTrainingChange((current) =>
            upsertMatchResult(current, {
              id: createMatchResultId(outcome.placeId, outcome.imageRecordId),
              placeId: outcome.placeId,
              imageRecordId: outcome.imageRecordId,
              classification: outcome.classification,
              matchedFeatures: outcome.matchedFeatures,
              score: outcome.score,
              reason: outcome.reason,
              provider: outcome.provider,
              analysisVersion: outcome.analysisVersion,
              engineVersion: outcome.engineVersion,
              matchedAt: new Date().toISOString(),
              status: "pending",
            })
          );
          consecutiveFailures = 0;
        } catch (error) {
          failures += 1;
          consecutiveFailures += 1;
          lastError = error instanceof Error ? error.message : "Unknown error";

          if (consecutiveFailures >= 3) {
            break;
          }
        }

        setProgress({ done: index + 1, total: candidates.length });
      }

      setMessage(
        failures > 0
          ? { tone: "error", text: `${failures} ${failures === 1 ? "photograph" : "photographs"} could not be compared: ${lastError}` }
          : { tone: "info", text: cancelRef.current ? "Search stopped." : "Search finished. Review the likely matches below." }
      );
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Search failed." });
    } finally {
      setIsMatching(false);
      setProgress(null);
    }
  }

  async function handleReevaluateMatches() {
    const matchFn = visionProvider.matchPlaceCandidate?.bind(visionProvider);
    const signatureFn = visionProvider.derivePlaceSignature?.bind(visionProvider);

    if (!matchFn || !signatureFn) {
      setMessage({ tone: "error", text: "The configured Vision provider cannot compare photographs to a place." });
      return;
    }

    const currentAnchors = getPlaceAnchors(getTraining(), place.id).filter((anchor) => anchorImages.has(anchor.id));
    if (!getMatchingReadiness(currentAnchors.length).ready) {
      return;
    }

    const candidates = selectReevaluationCandidates(
      visitRef.current,
      place.id,
      getTraining(),
      MAX_REEVALUATION_CANDIDATES_PER_RUN
    );
    if (candidates.length === 0) {
      setMessage({ tone: "info", text: "There are no eligible existing matches to re-evaluate for this place." });
      return;
    }

    cancelRef.current = false;
    setIsMatching(true);
    setMessage(null);
    setReevaluationSummary(null);
    setProgress({ done: 0, total: candidates.length });

    let changed = 0;
    let same = 0;
    let failures = 0;
    let consecutiveFailures = 0;
    let lastError = "";
    const engineVersions = new Set<string>();
    const resultIds: string[] = [];

    try {
      const { signature, anchorDataUrls } = await resolvePlaceSignature({
        provider: visionProvider,
        placeId: place.id,
        placeName: place.displayName,
        anchors: currentAnchors.map((anchor) => ({ id: anchor.id, blob: (anchorImages.get(anchor.id) as StoredAnchorImage).blob })),
        getTraining,
        commit: onTrainingChange,
      });

      for (const [index, record] of candidates.entries()) {
        if (cancelRef.current) {
          break;
        }

        if (!isRecordEligibleNow(visitRef.current, record.id)) {
          setProgress({ done: index + 1, total: candidates.length });
          continue;
        }

        try {
          const url = createThumbnailUrlForRecord(record);
          if (!url) {
            throw new Error("Photograph image data is no longer available.");
          }
          const analysisImage = await createAnalysisImage(await imageUrlToBlob(url));
          const candidateImageDataUrl = await blobToDataUrl(analysisImage.blob);

          if (!isRecordEligibleNow(visitRef.current, record.id)) {
            setProgress({ done: index + 1, total: candidates.length });
            continue;
          }

          const outcome = await matchFn({
            placeId: place.id,
            placeName: place.displayName,
            imageRecordId: record.id,
            candidateImageDataUrl,
            anchorImageDataUrls: anchorDataUrls,
            signature,
          });

          if (!isRecordEligibleNow(visitRef.current, record.id)) {
            setProgress({ done: index + 1, total: candidates.length });
            continue;
          }

          if (!outcome.engineVersion) {
            throw new Error("Vision proxy response did not identify the matching engine version.");
          }
          engineVersions.add(outcome.engineVersion);

          const saved = saveReevaluatedMatch(visitRef.current, getTraining(), {
            id: createMatchResultId(outcome.placeId, outcome.imageRecordId),
            placeId: outcome.placeId,
            imageRecordId: outcome.imageRecordId,
            classification: outcome.classification,
            matchedFeatures: outcome.matchedFeatures,
            score: outcome.score,
            reason: outcome.reason,
            provider: outcome.provider,
            analysisVersion: outcome.analysisVersion,
            engineVersion: outcome.engineVersion,
            matchedAt: new Date().toISOString(),
            status: "pending",
          });

          if (!saved) {
            throw new Error("The match was reviewed or assigned while it was being re-evaluated; the saved result was left unchanged.");
          }

          onTrainingChange(() => saved.state);
          if (saved.classificationChanged) {
            changed += 1;
          } else {
            same += 1;
          }
          resultIds.push(createMatchResultId(outcome.placeId, outcome.imageRecordId));
          consecutiveFailures = 0;
        } catch (error) {
          failures += 1;
          consecutiveFailures += 1;
          lastError = error instanceof Error ? error.message : "Unknown error";

          if (consecutiveFailures >= 3) {
            break;
          }
        }

        setProgress({ done: index + 1, total: candidates.length });
      }

      const engineVersion = Array.from(engineVersions).join(", ") || null;
      setReevaluationSummary({ changed, same, failures, engineVersion, stopped: cancelRef.current, resultIds });
      setMessage(
        failures > 0
          ? {
              tone: "error",
              text: `${failures} ${failures === 1 ? "photograph" : "photographs"} could not be re-evaluated: ${lastError}`,
            }
          : { tone: "info", text: cancelRef.current ? "Re-evaluation stopped." : "Re-evaluation finished." }
      );
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Re-evaluation failed." });
      setReevaluationSummary({
        changed,
        same,
        failures: candidates.length - changed - same,
        engineVersion: Array.from(engineVersions).join(", ") || null,
        stopped: cancelRef.current,
        resultIds,
      });
    } finally {
      setIsMatching(false);
      setProgress(null);
    }
  }

  function handleApprove(resultId: string) {
    const error = onApproveMatch(resultId);
    setUndoResultId(null);
    setMessage(error ? { tone: "error", text: error } : { tone: "info", text: `Assigned to ${place.displayName}.` });
  }

  function handleReassign(resultId: string, targetPlaceId: string) {
    if (!targetPlaceId) {
      return;
    }

    const error = onReassignMatch(resultId, targetPlaceId);
    setUndoResultId(error ? null : resultId);
    setMessage(
      error
        ? { tone: "error", text: error }
        : { tone: "info", text: `Assigned to ${getPlaceById(targetPlaceId)?.displayName ?? targetPlaceId}.` }
    );
  }

  function handleUnsure(resultId: string) {
    onMarkUnsure(resultId);
    setUndoResultId(resultId);
    setMessage({ tone: "info", text: "Left unassigned. It can still be matched to other places." });
  }

  function handleUndo() {
    if (!undoResultId) {
      return;
    }

    const error = onUndoReview(undoResultId);
    setUndoResultId(null);
    setMessage(error ? { tone: "error", text: error } : { tone: "info", text: "Review undone." });
  }

  async function handleExportAnchorImages() {
    setBackupStatus(null);

    try {
      const backup = await createAnchorImageBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `blomzip-anchor-images-${backup.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setBackupStatus({ tone: "info", text: `Exported ${backup.images.length} anchor image(s).` });
    } catch (error) {
      setBackupStatus({ tone: "error", text: error instanceof Error ? error.message : "Could not export anchor images." });
    }
  }

  async function handleImportAnchorImages(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setBackupStatus(null);
    setIsBusy(true);

    try {
      const outcome = await importAnchorImageBackup(await file.text());

      if (!outcome.ok) {
        setBackupStatus({ tone: "error", text: `${outcome.error} Nothing was imported.` });
        return;
      }

      const { added, skipped, errors } = outcome.result;
      setBackupStatus({
        tone: errors > 0 ? "error" : "info",
        text: `Import finished: ${added} added, ${skipped} skipped (already present), ${errors} error(s).`,
      });
      setAnchorReloadCount((count) => count + 1);
    } catch {
      setBackupStatus({ tone: "error", text: "Could not read the selected file. Nothing was imported." });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="place-training-panel" data-testid="place-training-panel" aria-label={`Train ${place.displayName}`}>
      <div className="place-training-header">
        <div>
          <p className="eyebrow">Train this place</p>
          <h3>{place.displayName}</h3>
        </div>
        <p className="result-count" data-testid="place-anchor-count">
          {anchors.length} visual {anchors.length === 1 ? "anchor" : "anchors"}
        </p>
      </div>

      <p className="result-count">
        Visual anchors are reference photographs of this place — for example downloaded from Google Photos. They are not
        added to the archive. Use {MIN_PLACE_ANCHORS}–{MAX_PLACE_ANCHORS}.
      </p>
      <p className="result-count" data-testid="place-anchor-backup-note">
        Anchor images are stored in this browser only and are not part of the normal archive backup. For full recovery
        keep both: the archive backup (anchor details, assignments and history) and the anchor-image backup (the image
        files). Importing only adds missing images; existing images are never overwritten.
      </p>
      <div className="place-training-actions" data-testid="place-anchor-backup-controls">
        <button
          type="button"
          className="secondary-action"
          data-testid="place-anchor-export-button"
          disabled={isBusy}
          onClick={() => void handleExportAnchorImages()}
        >
          Export anchor images
        </button>
        <label className={`secondary-action${isBusy ? " is-disabled" : ""}`}>
          Import anchor images
          <input
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="place-anchor-import-input"
            disabled={isBusy}
            onChange={(event) => void handleImportAnchorImages(event)}
          />
        </label>
      </div>
      {backupStatus ? (
        <p className="result-count" role="status" data-testid="place-anchor-backup-status">
          {backupStatus.text}
        </p>
      ) : null}

      <div className="place-anchor-grid">
        {anchors.map((anchor) => {
          const previewUrl = previewUrls.get(anchor.id);
          const hasImage = anchorImages.has(anchor.id);

          return (
            <figure key={anchor.id} className="place-anchor-item" data-testid={`place-anchor-${anchor.id}`}>
              {hasImage && previewUrl ? (
                <PreviewThumbnailButton
                  target={{ src: previewUrl, filename: anchor.filename, placeLabel: place.displayName, alt: `Visual anchor ${anchor.filename}` }}
                  onOpen={openImagePreview}
                >
                  <img src={previewUrl} alt={`Visual anchor ${anchor.filename}`} />
                </PreviewThumbnailButton>
              ) : (
                <div className="place-anchor-missing">{hasImage ? "Loading…" : "Image missing — re-upload"}</div>
              )}
              <figcaption>
                <span title={anchor.filename}>{anchor.filename}</span>
                <span className="place-anchor-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={isBusy || isMatching}
                    onClick={() => {
                      replaceTargetRef.current = anchor.id;
                      replaceInputRef.current?.click();
                    }}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={isMatching}
                    onClick={() => handleRemove(anchor.id)}
                    aria-label={`Remove visual anchor ${anchor.filename}`}
                  >
                    Remove
                  </button>
                </span>
              </figcaption>
            </figure>
          );
        })}
      </div>

      <input
        ref={replaceInputRef}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        data-testid="place-anchor-replace-input"
        onChange={(event) => void handleReplaceSelected(event)}
      />

      {isPickingFromArchive ? (
        <div className="place-match-list" data-testid="archive-anchor-picker">
          <h4>Select anchors from archive</h4>
          <p className="result-count">
            These photographs are assigned to {place.displayName}, but an assignment is not proof that a photograph is a good
            example. Choose only clear, representative photographs; nothing is selected for you. Selected:{" "}
            {pickedRecordIds.length} (this place would have {anchors.length + pickedRecordIds.length} of {MIN_PLACE_ANCHORS}–
            {MAX_PLACE_ANCHORS} anchors).
          </p>
          <div className="place-anchor-grid">
            {archiveCandidates.length === 0 ? (
              <p className="result-count">No archive photographs are assigned to this place yet.</p>
            ) : null}
            {archiveCandidates.map(({ record, verified, alreadyAnchor, hasImageData }) => {
              const thumbnail = createThumbnailUrlForRecord(record);
              const picked = pickedRecordIds.includes(record.id);

              return (
                <figure key={record.id} className="place-anchor-item" data-testid={`archive-anchor-candidate-${record.id}`}>
                  {thumbnail && hasImageData ? (
                    <PreviewThumbnailButton
                      target={{ src: thumbnail, filename: record.filename, placeLabel: place.displayName }}
                      onOpen={openImagePreview}
                    >
                      <img src={thumbnail} alt="" />
                    </PreviewThumbnailButton>
                  ) : (
                    <div className="place-anchor-missing">No image data</div>
                  )}
                  <figcaption>
                    <span title={record.filename}>{record.filename}</span>
                    <small>{verified ? "Approved by you for this place" : "Assigned only — not verified"}</small>
                    <label>
                      <input
                        type="checkbox"
                        checked={picked}
                        disabled={alreadyAnchor || !hasImageData || isBusy}
                        onChange={(event) =>
                          setPickedRecordIds((current) =>
                            event.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id)
                          )
                        }
                      />{" "}
                      {alreadyAnchor ? "Already an anchor" : `Use ${record.filename} as anchor`}
                    </label>
                  </figcaption>
                </figure>
              );
            })}
          </div>
          <div className="place-anchor-actions">
            <button
              type="button"
              className="secondary-action"
              data-testid="confirm-archive-anchors"
              disabled={isBusy || pickedRecordIds.length === 0}
              onClick={() => void handleConfirmArchiveAnchors()}
            >
              Confirm {pickedRecordIds.length} as visual {pickedRecordIds.length === 1 ? "anchor" : "anchors"}
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                setPickedRecordIds([]);
                setIsPickingFromArchive(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="place-training-actions">
        <label className={`secondary-action place-anchor-upload${isBusy || isMatching || anchors.length >= MAX_PLACE_ANCHORS ? " is-disabled" : ""}`}>
          Upload visual anchors
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            hidden
            data-testid="place-anchor-upload-input"
            disabled={isBusy || isMatching || anchors.length >= MAX_PLACE_ANCHORS}
            onChange={(event) => void handleUpload(event)}
          />
        </label>

        <button
          type="button"
          className="secondary-action"
          data-testid="select-archive-anchors"
          aria-expanded={isPickingFromArchive}
          disabled={isBusy || isMatching || anchors.length >= MAX_PLACE_ANCHORS}
          onClick={() => setIsPickingFromArchive((current) => !current)}
        >
          Select anchors from archive
        </button>

        <button
          type="button"
          className="secondary-action"
          data-testid="find-more-photos"
          disabled={!readiness.ready || isMatching || isBusy || remainingCandidates === 0}
          onClick={() => void handleFindMatches()}
        >
          Find more photos from this place
        </button>

        <button
          type="button"
          className="secondary-action"
          data-testid="reevaluate-place-matches"
          disabled={!readiness.ready || isMatching || isBusy || reevaluationCandidateCount === 0}
          onClick={() => void handleReevaluateMatches()}
        >
          Re-evaluate matches ({Math.min(reevaluationCandidateCount, MAX_REEVALUATION_CANDIDATES_PER_RUN)})
        </button>

        {isMatching ? (
          <button type="button" className="secondary-action" onClick={() => { cancelRef.current = true; }}>
            Stop
          </button>
        ) : null}
      </div>

      {!readiness.ready ? (
        <p className="result-count" data-testid="place-training-needs-more">
          {readiness.message}
        </p>
      ) : (
        <p className="result-count">
          {remainingCandidates} unassigned {remainingCandidates === 1 ? "photograph" : "photographs"} not yet compared
          {remainingCandidates > MAX_MATCH_CANDIDATES_PER_RUN ? ` — each search compares up to ${MAX_MATCH_CANDIDATES_PER_RUN}` : ""}.
        </p>
      )}

      <p className="result-count" data-testid="reevaluation-candidate-count">
        {reevaluationCandidateCount} existing unreviewed {reevaluationCandidateCount === 1 ? "match" : "matches"} eligible
        for re-evaluation; each run is capped at {MAX_REEVALUATION_CANDIDATES_PER_RUN} photographs.
      </p>

      {reevaluationSummary ? (
        <>
          <p className="result-count" data-testid="reevaluation-summary" role="status">
            Re-evaluation comparison: {reevaluationSummary.changed} classification changed, {reevaluationSummary.same} stayed
            the same, {reevaluationSummary.failures} failed.
            {reevaluationSummary.engineVersion ? ` Engine: ${reevaluationSummary.engineVersion}.` : " Engine version unavailable."}
            {reevaluationSummary.stopped ? " Stopped by user." : ""}
          </p>
          {reevaluationComparisons.length > 0 ? (
            <div className="place-reevaluation-results" data-testid="reevaluation-comparisons" aria-label="Re-evaluation result comparisons">
              {reevaluationComparisons.map(({ result, record, previous, classificationChanged }) => {
                const thumbnail = createThumbnailUrlForRecord(record);

                return (
                  <article
                    key={result.id}
                    className={`place-reevaluation-item${classificationChanged ? " changed" : ""}`}
                    data-testid={`reevaluation-comparison-${result.imageRecordId}`}
                  >
                    {thumbnail ? (
                      <PreviewThumbnailButton
                    target={{ src: thumbnail, filename: record.filename, placeLabel: getPlaceById(record.placeId ?? "")?.displayName ?? "Unassigned" }}
                    onOpen={openImagePreview}
                  >
                    <img src={thumbnail} alt="" />
                  </PreviewThumbnailButton>
                    ) : null}
                    <div className="place-reevaluation-details">
                      <strong title={record.filename}>{record.filename}</strong>
                      <span>
                        {previous.classification} → {result.classification}
                        {classificationChanged ? <b className="place-reevaluation-changed">Changed</b> : null}
                      </span>
                      <small>{percent(previous.score)} → {percent(result.score)}</small>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}

      {progress ? (
        <p className="result-count" role="status">
          Comparing photograph {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      ) : null}

      {message ? (
        <p className={`place-training-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
          {undoResultId ? (
            <>
              {" "}
              <button type="button" className="secondary-action" onClick={handleUndo}>
                Undo
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {pendingMatches.length > 0 ? (
        <div className="place-match-list" data-testid="place-match-list">
          <h4>Likely matches</h4>
          {pendingMatches.map((match) => {
            const record = recordsById.get(match.imageRecordId);
            const thumbnail = record ? createThumbnailUrlForRecord(record) : undefined;

            return (
              <article key={match.id} className="place-match-item" data-testid={`place-match-${match.imageRecordId}`}>
                {thumbnail ? (
                  <PreviewThumbnailButton
                    target={{ src: thumbnail, filename: record?.filename ?? "Candidate photograph", placeLabel: `Suggested: ${place.displayName}` }}
                    onOpen={openImagePreview}
                  >
                    <img src={thumbnail} alt="" />
                  </PreviewThumbnailButton>
                ) : null}
                <div>
                  <strong className={`place-match-confidence ${getMatchConfidence(match.score)}`}>
                    {MATCH_CONFIDENCE_LABELS[getMatchConfidence(match.score)]}
                  </strong>
                  <small className="place-match-score"> model-estimated score {percent(match.score)} (not a measured probability)</small>
                  <p>{match.reason}</p>
                  {match.matchedFeatures?.length ? (
                    <p className="place-match-features">Matched: {match.matchedFeatures.join(", ")}</p>
                  ) : null}
                  {match.previousEvaluations?.length ? (
                    <small className="place-match-previous">
                      Previous: {match.previousEvaluations[match.previousEvaluations.length - 1].classification} (
                      {percent(match.previousEvaluations[match.previousEvaluations.length - 1].score)})
                    </small>
                  ) : null}
                  <div className="place-anchor-actions">
                    <button type="button" className="secondary-action" onClick={() => handleApprove(match.id)}>
                      Approve suggested place
                    </button>
                    <select
                      aria-label="Assign another place"
                      value=""
                      onChange={(event) => handleReassign(match.id, event.target.value)}
                    >
                      <option value="">Assign another place…</option>
                      {listCanonicalPlaces()
                        .filter((candidate) => candidate.id !== place.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.displayName}
                          </option>
                        ))}
                    </select>
                    <button type="button" className="secondary-action" onClick={() => handleUnsure(match.id)}>
                      Not sure
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {nearbyMatches.length > 0 ? (
        <details className="place-match-list" data-testid="place-nearby-list">
          <summary>Nearby / same courtyard ({nearbyMatches.length})</summary>
          <p className="result-count">
            These look like the same courtyard, but the place itself was not clearly confirmed. They are not offered for approval.
          </p>
          {nearbyMatches.map((match) => {
            const record = recordsById.get(match.imageRecordId);
            const thumbnail = record ? createThumbnailUrlForRecord(record) : undefined;

            return (
              <article key={match.id} className="place-match-item" data-testid={`place-nearby-${match.imageRecordId}`}>
                {thumbnail ? (
                  <PreviewThumbnailButton
                    target={{ src: thumbnail, filename: record?.filename ?? "Nearby photograph", placeLabel: `Nearby context (not assigned): ${place.displayName}` }}
                    onOpen={openImagePreview}
                  >
                    <img src={thumbnail} alt="" />
                  </PreviewThumbnailButton>
                ) : null}
                <div>
                  <p>{match.reason}</p>
                  {match.previousEvaluations?.length ? (
                    <small className="place-match-previous">
                      Previous: {match.previousEvaluations[match.previousEvaluations.length - 1].classification} (
                      {percent(match.previousEvaluations[match.previousEvaluations.length - 1].score)})
                    </small>
                  ) : null}
                </div>
              </article>
            );
          })}
        </details>
      ) : null}

      {promotableApproved.length > 0 ? (
        <div className="place-match-list" data-testid="place-promote-list">
          <h4>Approved photographs</h4>
          {promotableApproved.map((match) => {
            const record = recordsById.get(match.imageRecordId);
            const thumbnail = record ? createThumbnailUrlForRecord(record) : undefined;

            return (
              <div key={match.id} className="place-match-item">
                {thumbnail ? (
                  <PreviewThumbnailButton
                    target={{ src: thumbnail, filename: record?.filename ?? "Approved photograph", placeLabel: place.displayName }}
                    onOpen={openImagePreview}
                  >
                    <img src={thumbnail} alt="" />
                  </PreviewThumbnailButton>
                ) : null}
                <div>
                  <p>{record?.filename ?? match.imageRecordId}</p>
                  <div className="place-anchor-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={isBusy || anchors.length >= MAX_PLACE_ANCHORS}
                      onClick={() => void handlePromote(match)}
                    >
                      Add this photo as a visual anchor
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {imagePreviewLightbox}
    </section>
  );
}
