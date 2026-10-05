import { useEffect, useRef, useState } from "react";
import type { CanonicalPlace } from "../data/canonicalPlaces";
import type {
  ImageRecord,
  PlaceMatchResult,
  PlaceTrainingState,
  PlaceVisualAnchor,
  Visit,
} from "../models/blomzip";
import { blobToDataUrl, createAnalysisImage, imageUrlToBlob } from "../utils/analysisImage";
import { createThumbnailUrlForRecord } from "../utils/createThumbnailUrls";
import { getAnchorImages, putAnchorImage, type StoredAnchorImage } from "../utils/placeAnchorStore";
import {
  addPlaceAnchors,
  countRemainingCandidates,
  createMatchResultId,
  getMatchConfidence,
  getMatchingReadiness,
  MATCH_CONFIDENCE_LABELS,
  getPlaceAnchors,
  isAcceptedAnchorFile,
  listNearbyContextMatches,
  listPendingMatches,
  MAX_MATCH_CANDIDATES_PER_RUN,
  MAX_PLACE_ANCHORS,
  MIN_PLACE_ANCHORS,
  removePlaceAnchor,
  replacePlaceAnchor,
  selectMatchCandidates,
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
  onRejectMatch: (resultId: string) => void;
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
  onRejectMatch,
  visionProvider,
}: PlaceTrainingPanelProps) {
  const anchors = getPlaceAnchors(training, place.id);
  const [anchorImages, setAnchorImages] = useState<Map<string, StoredAnchorImage>>(new Map());
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const previewUrlsRef = useRef<Map<string, string>>(new Map());
  const cancelRef = useRef(false);
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
  }, [anchorIdKey]);

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
  const recordsById = new Map<string, ImageRecord>((visit?.imageRecords ?? []).map((record) => [record.id, record]));
  const promotableApproved = training.matchResults.filter(
    (result) =>
      result.placeId === place.id &&
      result.status === "approved" &&
      recordsById.get(result.imageRecordId)?.placeId === place.id &&
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
      const anchorDataUrls = await Promise.all(
        currentAnchors.map((anchor) => blobToDataUrl((anchorImages.get(anchor.id) as StoredAnchorImage).blob))
      );
      const signature = await signatureFn({ placeName: place.displayName, anchorImageDataUrls: anchorDataUrls });

      for (const [index, record] of candidates.entries()) {
        if (cancelRef.current) {
          break;
        }

        try {
          const url = createThumbnailUrlForRecord(record) as string;
          const analysisImage = await createAnalysisImage(await imageUrlToBlob(url));
          const outcome = await matchFn({
            placeId: place.id,
            placeName: place.displayName,
            imageRecordId: record.id,
            candidateImageDataUrl: await blobToDataUrl(analysisImage.blob),
            anchorImageDataUrls: anchorDataUrls,
            signature,
          });

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

  function handleApprove(resultId: string) {
    const error = onApproveMatch(resultId);
    setMessage(error ? { tone: "error", text: error } : { tone: "info", text: `Assigned to ${place.displayName}.` });
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
        Uploaded training images are stored in this browser only and are not included in archive backups. After restoring
        a backup on another browser or device, re-upload them.
      </p>

      <div className="place-anchor-grid">
        {anchors.map((anchor) => {
          const previewUrl = previewUrls.get(anchor.id);
          const hasImage = anchorImages.has(anchor.id);

          return (
            <figure key={anchor.id} className="place-anchor-item" data-testid={`place-anchor-${anchor.id}`}>
              {hasImage && previewUrl ? (
                <img src={previewUrl} alt={`Visual anchor ${anchor.filename}`} />
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
          data-testid="find-more-photos"
          disabled={!readiness.ready || isMatching || isBusy || remainingCandidates === 0}
          onClick={() => void handleFindMatches()}
        >
          Find more photos from this place
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

      {progress ? (
        <p className="result-count" role="status">
          Comparing photograph {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      ) : null}

      {message ? (
        <p className={`place-training-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
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
                {thumbnail ? <img src={thumbnail} alt={record?.filename ?? "Candidate photograph"} /> : null}
                <div>
                  <strong className={`place-match-confidence ${getMatchConfidence(match.score)}`}>
                    {MATCH_CONFIDENCE_LABELS[getMatchConfidence(match.score)]}
                  </strong>
                  <small className="place-match-score"> score {percent(match.score)}</small>
                  <p>{match.reason}</p>
                  {match.matchedFeatures?.length ? (
                    <p className="place-match-features">Matched: {match.matchedFeatures.join(", ")}</p>
                  ) : null}
                  <div className="place-anchor-actions">
                    <button type="button" className="secondary-action" onClick={() => handleApprove(match.id)}>
                      Approve place
                    </button>
                    <button type="button" className="secondary-action" onClick={() => onRejectMatch(match.id)}>
                      Reject
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
                {thumbnail ? <img src={thumbnail} alt={record?.filename ?? "Nearby photograph"} /> : null}
                <div>
                  <p>{match.reason}</p>
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
                {thumbnail ? <img src={thumbnail} alt={record?.filename ?? "Approved photograph"} /> : null}
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
    </section>
  );
}
