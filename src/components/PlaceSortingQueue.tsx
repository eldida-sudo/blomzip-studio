import { useEffect, useRef, useState } from "react";
import { getPlaceById, listCanonicalPlaces } from "../data/canonicalPlaces";
import type { ImageRecord, PlaceTrainingState, Visit } from "../models/blomzip";
import { blobToDataUrl, createAnalysisImage, imageUrlToBlob } from "../utils/analysisImage";
import { createThumbnailUrlForRecord } from "../utils/createThumbnailUrls";
import { MIN_PLACE_ANCHORS } from "../utils/placeTraining";
import { getAnchorImages, type StoredAnchorImage } from "../utils/placeAnchorStore";
import {
  buildSortingQueue,
  buildTrainingReadiness,
  listSetAsidePhotos,
  SORTING_BATCH_SIZE,
  type SortingCandidate,
  type SortingProposal,
} from "../utils/placeSorting";
import { computeSortingReadiness, runSortingBatch, type SortingReadiness } from "../utils/placeSortingRun";
import type { VisionProvider } from "../utils/visionProvider";
import { PreviewThumbnailButton, useImagePreview } from "./ImagePreviewLightbox";

interface PlaceSortingQueueProps {
  visit: Visit | null;
  training: PlaceTrainingState;
  getTraining: () => PlaceTrainingState;
  onTrainingChange: (updater: (current: PlaceTrainingState) => PlaceTrainingState) => void;
  onAssign: (proposal: SortingProposal, targetPlaceId: string) => string | null;
  onSetAside: (proposal: SortingProposal) => void;
  onReturnToQueue: (imageRecordId: string) => void;
  visionProvider: VisionProvider;
}

const STATUS_LABELS: Record<SortingProposal["status"], string> = {
  proposed: "Proposed primary place",
  uncertain: "Uncertain",
  unassigned: "No single primary place",
  incomplete: "Not compared against every trained place",
};

function placeName(placeId: string): string {
  return getPlaceById(placeId)?.displayName ?? placeId;
}

function percent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function CandidateEvidence({ candidate, label }: { candidate: SortingCandidate; label: string }) {
  const previous = candidate.previousEvaluations[candidate.previousEvaluations.length - 1];

  return (
    <li data-testid={`sorting-candidate-${candidate.placeId}`}>
      <strong>{placeName(candidate.placeId)}</strong> <small>{label} · model-estimated score {percent(candidate.score)}</small>
      {candidate.matchedFeatures.length > 0 ? <p className="place-match-features">Matched: {candidate.matchedFeatures.join(", ")}</p> : null}
      <p>{candidate.reason}</p>
      {previous ? (
        <small className="place-match-previous">
          Previous: {previous.classification} ({percent(previous.score)})
        </small>
      ) : null}
    </li>
  );
}

export function PlaceSortingQueue({
  visit,
  training,
  getTraining,
  onTrainingChange,
  onAssign,
  onSetAside,
  onReturnToQueue,
  visionProvider,
}: PlaceSortingQueueProps) {
  const { open: openImagePreview, lightbox } = useImagePreview();
  const [anchorImages, setAnchorImages] = useState<Map<string, StoredAnchorImage>>(new Map());
  const [anchorsLoaded, setAnchorsLoaded] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [readiness, setReadiness] = useState<SortingReadiness | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const cancelRef = useRef(false);

  const anchorIdKey = Object.values(training.anchorsByPlaceId)
    .flatMap((anchors) => anchors.map((anchor) => anchor.id))
    .join("|");
  const availableAnchorIds = new Set(anchorImages.keys());
  const readinessRows = buildTrainingReadiness(listCanonicalPlaces(), visit, training, availableAnchorIds);
  // Only places whose anchor images are actually available take part, matching what a run compares.
  const eligiblePlaceIds = anchorsLoaded ? readinessRows.filter((row) => row.eligible).map((row) => row.placeId) : [];
  const queue = buildSortingQueue(visit, training, eligiblePlaceIds);
  const setAside = listSetAsidePhotos(visit, training);

  useEffect(() => {
    let cancelled = false;

    void getAnchorImages(anchorIdKey ? anchorIdKey.split("|") : []).then((images) => {
      if (!cancelled) {
        setAnchorImages(images);
        setAnchorsLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [anchorIdKey]);

  useEffect(
    () => () => {
      cancelRef.current = true;
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    void computeSortingReadiness(visit, training, anchorImages).then(
      (next) => {
        if (!cancelled) {
          setReadiness(next);
        }
      },
      () => undefined
    );

    return () => {
      cancelled = true;
    };
  }, [visit, training, anchorImages]);

  async function handleRun() {
    if (!visit || isRunning) {
      return;
    }

    cancelRef.current = false;
    setIsRunning(true);
    setMessage(null);

    try {
      const summary = await runSortingBatch(visit, {
        provider: visionProvider,
        getTraining,
        commit: onTrainingChange,
        anchorImages,
        prepareCandidateImage: async (record: ImageRecord) =>
          blobToDataUrl(
            (await createAnalysisImage(await imageUrlToBlob(createThumbnailUrlForRecord(record) as string))).blob
          ),
        isCancelled: () => cancelRef.current,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const calls = summary.comparisonCalls + summary.signatureCalls;

      setMessage(
        summary.failures > 0
          ? { tone: "error", text: `${summary.failures} comparison(s) failed: ${summary.lastError}. ${calls} model calls were made.` }
          : {
              tone: "info",
              text: `${summary.stopped ? "Stopped. " : ""}${calls} model calls made (${summary.comparisonCalls} comparisons, ${summary.signatureCalls} signatures).`,
            }
      );
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Sorting failed." });
    } finally {
      setIsRunning(false);
      setProgress(null);
    }
  }

  function handleAssign(proposal: SortingProposal, targetPlaceId: string) {
    const error = onAssign(proposal, targetPlaceId);
    setRowErrors((current) => {
      const { [proposal.imageRecordId]: _removed, ...rest } = current;
      return error ? { ...rest, [proposal.imageRecordId]: error } : rest;
    });
  }

  const registeredTotal = readinessRows.reduce((total, row) => total + row.registeredAnchors, 0);

  if (!visit || (registeredTotal === 0 && queue.length === 0 && setAside.length === 0)) {
    return null;
  }

  const comparisonCount = readiness?.plan.comparisonCount ?? 0;
  const signatureCount = readiness?.uncachedSignaturePlaceIds.length ?? 0;
  const photoCount = readiness?.plan.items.length ?? 0;

  return (
    <section className="place-training-panel place-sorting-queue" data-testid="place-sorting-queue" aria-label="Sorting queue">
      <button
        type="button"
        className="secondary-action"
        data-testid="sorting-toggle"
        aria-expanded={isExpanded}
        aria-controls="sorting-queue-body"
        onClick={() => setIsExpanded((current) => !current)}
      >
        {isExpanded ? "▾" : "▸"} Sorting queue
      </button>
      <p className="result-count" data-testid="sorting-summary" role="status">
        {queue.length} in queue · {eligiblePlaceIds.length} of {readinessRows.length} places eligible for matching ·{" "}
        {comparisonCount + signatureCount} expected model calls
      </p>

      <div id="sorting-queue-body" hidden={!isExpanded}>
      <details className="place-match-list" data-testid="training-readiness" open>
        <summary>Training readiness</summary>
        <p className="result-count">
          Visual anchors are the reference images used to teach a place. Photographs assigned in the archive are not
          anchors and do not count towards the {MIN_PLACE_ANCHORS} needed.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Place</th>
              <th scope="col">Registered anchors</th>
              <th scope="col">Available images</th>
              <th scope="col">Assigned photos</th>
              <th scope="col">Multi-place matching</th>
            </tr>
          </thead>
          <tbody>
            {readinessRows.map((row) => (
              <tr key={row.placeId} data-testid={`readiness-${row.placeId}`}>
                <th scope="row">{row.displayName}</th>
                <td>{row.registeredAnchors}</td>
                <td>{anchorsLoaded ? row.availableAnchors : "…"}</td>
                <td>{row.assignedPhotos}</td>
                <td>
                  {!anchorsLoaded
                    ? "Checking…"
                    : row.eligible
                      ? "Eligible"
                      : row.missingAnchors > 0
                        ? `Image data missing for ${row.missingAnchors} — re-upload (needs ${MIN_PLACE_ANCHORS})`
                        : `Not eligible (needs ${MIN_PLACE_ANCHORS} anchors)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="result-count" data-testid="sorting-expected-calls" role="status">
        Next batch: {photoCount} {photoCount === 1 ? "photograph" : "photographs"} (maximum {SORTING_BATCH_SIZE}),{" "}
        {comparisonCount} expected image {comparisonCount === 1 ? "comparison" : "comparisons"}
        {signatureCount > 0 ? ` plus ${signatureCount} place ${signatureCount === 1 ? "signature" : "signatures"} to derive` : ""} —{" "}
        {comparisonCount + signatureCount} model calls in total.
      </p>

      <div className="place-anchor-actions">
        <button
          type="button"
          className="secondary-action"
          data-testid="sorting-run"
          disabled={isRunning || comparisonCount === 0}
          onClick={() => void handleRun()}
        >
          {isRunning ? "Comparing…" : `Compare next ${photoCount} ${photoCount === 1 ? "photograph" : "photographs"}`}
        </button>
        {isRunning ? (
          <button type="button" className="secondary-action" onClick={() => (cancelRef.current = true)}>
            Stop
          </button>
        ) : null}
      </div>

      {progress ? (
        <p className="result-count" role="status">
          Comparison {Math.min(progress.done + 1, progress.total)} of {progress.total}…
        </p>
      ) : null}
      {message ? (
        <p className={`place-training-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}

      {queue.length === 0 ? (
        <p className="result-count" data-testid="sorting-queue-empty">
          No sorted suggestions to review yet.
        </p>
      ) : (
        <div className="place-match-list">
          {queue.map(({ record, proposal }) => {
            const thumbnail = createThumbnailUrlForRecord(record);

            return (
              <article key={record.id} className="place-match-item" data-testid={`sorting-item-${record.id}`}>
                {thumbnail ? (
                  <PreviewThumbnailButton
                    target={{
                      src: thumbnail,
                      filename: record.filename,
                      placeLabel: proposal.primary ? `Proposed: ${placeName(proposal.primary.placeId)}` : "Unassigned",
                    }}
                    onOpen={openImagePreview}
                  >
                    <img src={thumbnail} alt="" />
                  </PreviewThumbnailButton>
                ) : null}
                <div>
                  <strong title={record.filename}>{record.filename}</strong>
                  <p data-testid={`sorting-status-${record.id}`} className={`sorting-status sorting-status-${proposal.status}`}>
                    {STATUS_LABELS[proposal.status]} — {proposal.statusReason}
                  </p>
                  <ul>
                    {proposal.primary ? <CandidateEvidence candidate={proposal.primary} label="Proposed primary" /> : null}
                    {proposal.alternatives.map((candidate) => (
                      <CandidateEvidence key={candidate.resultId} candidate={candidate} label="Alternative" />
                    ))}
                    {proposal.context.map((candidate) => (
                      <CandidateEvidence key={candidate.resultId} candidate={candidate} label="Secondary context only" />
                    ))}
                  </ul>
                  <div className="place-anchor-actions">
                    {proposal.primary ? (
                      <button
                        type="button"
                        className="secondary-action"
                        data-testid={`sorting-approve-${record.id}`}
                        onClick={() => handleAssign(proposal, (proposal.primary as SortingCandidate).placeId)}
                      >
                        Approve {placeName(proposal.primary.placeId)}
                      </button>
                    ) : null}
                    <select
                      aria-label={`Assign another place to ${record.filename}`}
                      value=""
                      onChange={(event) => event.target.value && handleAssign(proposal, event.target.value)}
                    >
                      <option value="">Assign another place…</option>
                      {listCanonicalPlaces()
                        .filter((candidate) => candidate.id !== proposal.primary?.placeId)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.displayName}
                          </option>
                        ))}
                    </select>
                    <button type="button" className="secondary-action" onClick={() => onSetAside(proposal)}>
                      Not sure
                    </button>
                  </div>
                  {rowErrors[record.id] ? (
                    <p className="place-training-message error" role="alert">
                      {rowErrors[record.id]}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {setAside.length > 0 ? (
        <details className="place-match-list" data-testid="sorting-set-aside">
          <summary>Not sure ({setAside.length})</summary>
          {setAside.map((record) => (
            <div key={record.id} className="place-match-item">
              <p>{record.filename}</p>
              <button type="button" className="secondary-action" onClick={() => onReturnToQueue(record.id)}>
                Return to queue
              </button>
            </div>
          ))}
        </details>
      ) : null}
      </div>
      {lightbox}
    </section>
  );
}
