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
import {
  buildSortingGroups,
  buildSortingProgress,
  getProposalFreshness,
  orderSortingItems,
  planBulkApproval,
  type BulkApprovalSkip,
  classifyGroupKind,
  type ResultFreshness,
  type SortingGroup,
  type SortingOrder,
  type SortingQueueItem,
} from "../utils/placeSortingGroups";
import type { VisionProvider } from "../utils/visionProvider";
import { PreviewThumbnailButton, useImagePreview } from "./ImagePreviewLightbox";

interface PlaceSortingQueueProps {
  visit: Visit | null;
  training: PlaceTrainingState;
  getTraining: () => PlaceTrainingState;
  onTrainingChange: (updater: (current: PlaceTrainingState) => PlaceTrainingState) => void;
  onAssign: (proposal: SortingProposal, targetPlaceId: string) => string | null;
  onBulkAssign: (proposals: SortingProposal[], targetPlaceId: string) => { assigned: number; skipped: BulkApprovalSkip[] };
  onSetAside: (proposal: SortingProposal) => void;
  onReturnToQueue: (imageRecordId: string) => void;
  visionProvider: VisionProvider;
}

const FRESHNESS_LABELS: Record<ResultFreshness, string> = {
  current: "No anchor change since this comparison",
  older: "May predate current anchors — anchors changed after this comparison",
  unknown: "Freshness cannot be verified",
};

const ORDER_LABELS: Record<SortingOrder, string> = {
  priority: "Actionable first",
  grouped: "Grouped by likely place",
  chronological: "Capture date",
  original: "Archive order",
};

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
  onBulkAssign,
  onSetAside,
  onReturnToQueue,
  visionProvider,
}: PlaceSortingQueueProps) {
  const { open: openImagePreview, lightbox } = useImagePreview();
  const [anchorImages, setAnchorImages] = useState<Map<string, StoredAnchorImage>>(new Map());
  const [anchorsLoaded, setAnchorsLoaded] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [order, setOrder] = useState<SortingOrder>("priority");
  const [view, setView] = useState<"gallery" | "focus">("gallery");
  const [focusIndex, setFocusIndex] = useState(0);
  const [bulkGroupKey, setBulkGroupKey] = useState<string | null>(null);
  const [bulkExcluded, setBulkExcluded] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<SortingReadiness | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const cancelRef = useRef(false);
  const visitRef = useRef(visit);
  visitRef.current = visit;

  const anchorIdKey = Object.values(training.anchorsByPlaceId)
    .flatMap((anchors) => anchors.map((anchor) => anchor.id))
    .join("|");
  const availableAnchorIds = new Set(anchorImages.keys());
  const readinessRows = buildTrainingReadiness(listCanonicalPlaces(), visit, training, availableAnchorIds);
  // Only places whose anchor images are actually available take part, matching what a run compares.
  const eligiblePlaceIds = anchorsLoaded ? readinessRows.filter((row) => row.eligible).map((row) => row.placeId) : [];
  const queue = buildSortingQueue(visit, training, eligiblePlaceIds);
  const setAside = listSetAsidePhotos(visit, training);
  const ordered = orderSortingItems(queue, order, visit?.imageRecords ?? []);
  const progress_ = buildSortingProgress(visit, training);

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
        getVisit: () => visitRef.current,
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

  function conclusion(proposal: SortingProposal): string {
    const names = proposal.alternatives.slice(0, 2).map((candidate) => placeName(candidate.placeId));

    if (proposal.status === "proposed" && proposal.primary) {
      return `Reliable suggestion: ${placeName(proposal.primary.placeId)}.`;
    }
    if (proposal.status === "uncertain" && names.length >= 2 && classifyGroupKind(proposal) === "ambiguous") {
      return `Ambiguous: could be ${names.join(" or ")}.`;
    }
    if (proposal.status === "uncertain") {
      return names.length > 0 ? `Weak evidence for ${names[0]}; no reliable suggestion.` : "No reliable suggestion.";
    }
    if (proposal.status === "incomplete") {
      return "Not yet compared against every trained place; no suggestion.";
    }
    return "No supported primary place.";
  }

  function toggleBulk(group: SortingGroup) {
    setBulkExcluded([]);
    setBulkGroupKey((current) => (current === group.key ? null : group.key));
  }

  function confirmBulk(group: SortingGroup) {
    const placeId = group.placeId as string;
    const plan = planBulkApproval(group.items, training, placeId);
    const chosen = plan.eligible.filter((item) => !bulkExcluded.includes(item.record.id)).map((item) => item.proposal);
    const outcome = onBulkAssign(chosen, placeId);

    setBulkGroupKey(null);
    setBulkExcluded([]);
    setMessage({
      tone: outcome.skipped.length > 0 ? "error" : "info",
      text: `Assigned ${outcome.assigned} ${outcome.assigned === 1 ? "photograph" : "photographs"} to ${placeName(placeId)}.${
        outcome.skipped.length > 0 ? ` ${outcome.skipped.length} left unchanged: ${outcome.skipped.map((skip) => skip.reason).join(" ")}` : ""
      }`,
    });
  }

  function renderCard(item: SortingQueueItem, index: number, bulk?: { checked: boolean; disabled: boolean; onChange: () => void }) {
    const { record, proposal } = item;
    const thumbnail = createThumbnailUrlForRecord(record);

    return (
      <article key={record.id} className="sorting-card" data-testid={`sorting-item-${record.id}`}>
        {thumbnail ? (
          <PreviewThumbnailButton
            target={{ src: thumbnail, filename: record.filename, placeLabel: proposal.primary ? `Proposed: ${placeName(proposal.primary.placeId)}` : "Unassigned" }}
            onOpen={openImagePreview}
          >
            <img src={thumbnail} alt="" />
          </PreviewThumbnailButton>
        ) : (
          <div className="sorting-no-preview">No preview</div>
        )}
        <strong className="sorting-filename" title={record.filename}>{record.filename}</strong>
        <p data-testid={`sorting-conclusion-${record.id}`} className={`sorting-status sorting-status-${proposal.status}`}>
          {conclusion(proposal)}
        </p>
        <small data-testid={`sorting-freshness-${record.id}`}>{FRESHNESS_LABELS[getProposalFreshness(training, proposal)]}</small>
        {bulk ? (
          <label>
            <input type="checkbox" checked={bulk.checked} disabled={bulk.disabled} onChange={bulk.onChange} /> Include {record.filename}
          </label>
        ) : null}
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
          <button
            type="button"
            className="secondary-action"
            data-testid={`sorting-review-${record.id}`}
            onClick={() => {
              setFocusIndex(index);
              setView("focus");
            }}
          >
            Review
          </button>
        </div>
        {rowErrors[record.id] ? (
          <p className="place-training-message error" role="alert">
            {rowErrors[record.id]}
          </p>
        ) : null}
      </article>
    );
  }

  function renderGroup(group: SortingGroup) {
    const heading =
      group.kind === "place" ? placeName(group.placeId as string) : group.kind === "ambiguous" ? "Ambiguous" : "Unresolved";
    const note =
      group.kind === "ambiguous"
        ? "Similarly plausible competing places. Review individually."
        : group.kind === "unresolved"
          ? "No supported primary place, weak or incomplete evidence."
          : null;
    const plan = group.kind === "place" ? planBulkApproval(group.items, training, group.placeId as string) : null;
    const selectedCount = plan ? plan.eligible.filter((item) => !bulkExcluded.includes(item.record.id)).length : 0;
    const eligibleIds = new Set(plan?.eligible.map((item) => item.record.id));

    return (
      <details key={group.key} className="place-match-list" open data-testid={`sorting-group-${group.key}`}>
        <summary>
          {heading} ({group.items.length})
        </summary>
        {note ? <p className="result-count">{note}</p> : null}
        {plan && plan.eligible.length > 1 ? (
          <button type="button" className="secondary-action" data-testid={`sorting-bulk-open-${group.key}`} onClick={() => toggleBulk(group)}>
            Approve several for {heading}…
          </button>
        ) : null}
        {plan && bulkGroupKey === group.key ? (
          <div className="sorting-bulk-preview" data-testid="sorting-bulk-preview">
            <p>
              Target place: <strong>{heading}</strong>. Only photographs without a place are affected; existing assignments are never
              changed. Each decision is added to the sorting history.
            </p>
            {plan.skipped.length > 0 ? (
              <p className="result-count">
                Not included: {plan.skipped.map(({ item, reason }) => `${item.record.filename} (${reason})`).join("; ")}
              </p>
            ) : null}
            <button
              type="button"
              className="secondary-action"
              data-testid="sorting-bulk-confirm"
              disabled={selectedCount === 0}
              onClick={() => confirmBulk(group)}
            >
              Confirm: assign {selectedCount} {selectedCount === 1 ? "photograph" : "photographs"} to {heading}
            </button>
          </div>
        ) : null}
        <div className="sorting-gallery">
          {group.items.map((item) =>
            renderCard(
              item,
              ordered.findIndex((candidate) => candidate.record.id === item.record.id),
              plan && bulkGroupKey === group.key && eligibleIds.has(item.record.id)
                ? {
                    checked: !bulkExcluded.includes(item.record.id),
                    disabled: false,
                    onChange: () =>
                      setBulkExcluded((current) =>
                        current.includes(item.record.id) ? current.filter((id) => id !== item.record.id) : [...current, item.record.id]
                      ),
                  }
                : undefined
            )
          )}
        </div>
      </details>
    );
  }

  function renderFocus() {
    if (ordered.length === 0) {
      return null;
    }

    const index = Math.min(focusIndex, ordered.length - 1);
    const { record, proposal } = ordered[index];
    const thumbnail = createThumbnailUrlForRecord(record);

    return (
      <article className="sorting-focus" data-testid="sorting-focus">
        <p className="result-count" data-testid="sorting-focus-position">
          Photograph {index + 1} of {ordered.length}
        </p>
        {thumbnail ? (
          <PreviewThumbnailButton
            target={{ src: thumbnail, filename: record.filename, placeLabel: proposal.primary ? `Proposed: ${placeName(proposal.primary.placeId)}` : "Unassigned" }}
            onOpen={openImagePreview}
          >
            <img src={thumbnail} alt="" />
          </PreviewThumbnailButton>
        ) : null}
        <strong className="sorting-filename" title={record.filename} data-testid="sorting-focus-filename">
          {record.filename}
        </strong>
        <p data-testid="sorting-focus-conclusion" className={`sorting-status sorting-status-${proposal.status}`}>
          {conclusion(proposal)}
        </p>
        <small>{FRESHNESS_LABELS[getProposalFreshness(training, proposal)]}</small>
        <div className="place-anchor-actions">
          {proposal.primary ? (
            <button
              type="button"
              className="secondary-action"
              data-testid="sorting-focus-approve"
              onClick={() => handleAssign(proposal, (proposal.primary as SortingCandidate).placeId)}
            >
              Approve {placeName(proposal.primary.placeId)}
            </button>
          ) : null}
          <select
            aria-label={`Canonical Place for ${record.filename}`}
            data-testid="sorting-focus-select"
            value=""
            onChange={(event) => event.target.value && handleAssign(proposal, event.target.value)}
          >
            <option value="">Canonical Place…</option>
            {listCanonicalPlaces()
              .filter((candidate) => candidate.id !== proposal.primary?.placeId)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName}
                </option>
              ))}
          </select>
          <button type="button" className="secondary-action" data-testid="sorting-focus-unsure" onClick={() => onSetAside(proposal)}>
            Not sure
          </button>
          <button
            type="button"
            className="secondary-action"
            data-testid="sorting-focus-skip"
            disabled={index >= ordered.length - 1}
            onClick={() => setFocusIndex(index + 1)}
          >
            Skip
          </button>
        </div>
        <div className="place-anchor-actions">
          <button type="button" className="secondary-action" data-testid="sorting-prev" disabled={index === 0} onClick={() => setFocusIndex(index - 1)}>
            Previous
          </button>
          <button
            type="button"
            className="secondary-action"
            data-testid="sorting-next"
            disabled={index >= ordered.length - 1}
            onClick={() => setFocusIndex(index + 1)}
          >
            Next
          </button>
        </div>
        {rowErrors[record.id] ? (
          <p className="place-training-message error" role="alert">
            {rowErrors[record.id]}
          </p>
        ) : null}
        <details data-testid="sorting-analysis">
          <summary>Show analysis</summary>
          <p className="result-count">{STATUS_LABELS[proposal.status]} — {proposal.statusReason} Scores are model estimates, not calibrated probabilities.</p>
          <ul>
            {proposal.primary ? <CandidateEvidence candidate={proposal.primary} label="Proposed primary" /> : null}
            {proposal.alternatives.map((candidate) => (
              <CandidateEvidence key={candidate.resultId} candidate={candidate} label="Alternative" />
            ))}
            {proposal.context.map((candidate) => (
              <CandidateEvidence key={candidate.resultId} candidate={candidate} label="Secondary context only" />
            ))}
          </ul>
        </details>
      </article>
    );
  }

  const registeredTotal = readinessRows.reduce((total, row) => total + row.registeredAnchors, 0);

  if (!visit || (registeredTotal === 0 && queue.length === 0 && setAside.length === 0)) {
    return null;
  }

  const comparisonCount = readiness?.plan.comparisonCount ?? 0;
  const signatureCount = readiness?.uncachedSignaturePlaceIds.length ?? 0;
  const photoCount = readiness?.plan.items.length ?? 0;
  const groups = order === "grouped" ? buildSortingGroups(queue) : [];

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
        {isExpanded ? "▾" : "▸"} Sorting queue ({queue.length})
      </button>
      <p className="result-count" data-testid="sorting-summary" role="status">
        {queue.length} in queue · {eligiblePlaceIds.length} of {readinessRows.length} places eligible for matching ·{" "}
        {comparisonCount + signatureCount} expected model calls
      </p>

      <div id="sorting-queue-body" hidden={!isExpanded}>
      <dl className="sorting-progress" data-testid="sorting-progress" aria-label="Sorting progress">
        {[
          [progress_.total, "photographs in archive"],
          [progress_.assigned, "assigned to a Canonical Place"],
          [progress_.curatorConfirmed, "with a recorded curator confirmation"],
          [progress_.awaiting, "awaiting a primary-place decision"],
          [progress_.overview, "Courtyard Overview"],
          [progress_.placeDetail, "Place Detail / Close-up"],
          [progress_.external, "External / Inspiration"],
          [progress_.editoriallyReviewed, "editorially reviewed"],
        ].map(([count, label]) => (
          <div key={label as string} className="sorting-progress-item">
            <dd>{count}</dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>
      <p className="result-count">
        Analysis does not mean sorted: only photographs with a Canonical Place count as sorted. Assignments without a recorded
        curator decision are not counted as confirmed.
      </p>

      {message ? (
        <p className={`place-training-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}

      <div className="place-anchor-actions">
        <label>
          Order{" "}
          <select aria-label="Queue order" data-testid="sorting-order" value={order} onChange={(event) => setOrder(event.target.value as SortingOrder)}>
            {(Object.keys(ORDER_LABELS) as SortingOrder[]).map((key) => (
              <option key={key} value={key}>
                {ORDER_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-action" data-testid="sorting-view-toggle" aria-pressed={view === "focus"} onClick={() => setView(view === "focus" ? "gallery" : "focus")}>
          {view === "focus" ? "Show gallery" : "Focused review"}
        </button>
      </div>

      {queue.length === 0 ? (
        <p className="result-count" data-testid="sorting-queue-empty">
          No sorted suggestions to review yet.
        </p>
      ) : view === "focus" ? (
        renderFocus()
      ) : order === "grouped" ? (
        groups.map(renderGroup)
      ) : (
        <div className="sorting-gallery">
          {ordered.map((item, index) => renderCard(item, index))}
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

      <details className="place-match-list" data-testid="training-readiness">
        <summary>Training readiness ({eligiblePlaceIds.length}/{readinessRows.length} eligible)</summary>
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

      <details className="place-match-list" data-testid="sorting-compare">
        <summary>Compare more photographs (model calls)</summary>
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
      </details>
      </div>
      {lightbox}
    </section>
  );
}
