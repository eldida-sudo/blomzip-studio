import { useEffect, useMemo, useState } from "react";
import type { PlaceMatchResult } from "../models/blomzip";
import {
  buildStoryProposals,
  findThenNow,
  type RankedPhoto,
  type StoryDiscoveryPhoto,
  type StoryProposal,
} from "../utils/storyDiscovery";

interface StoryDiscoveryProps {
  photos: readonly StoryDiscoveryPhoto[];
  matchResults: readonly PlaceMatchResult[];
  /** Opens the app's existing Story selection view. Story discovery itself never edits it. */
  onViewStory: () => void;
  onClose: () => void;
}

type ProposalStatus = "draft" | "approved" | "skipped";

const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Draft proposal",
  approved: "Approved — not published",
  skipped: "Skipped",
};

function formatDate(photo: StoryDiscoveryPhoto): string {
  const date = photo.captureDate ? new Date(photo.captureDate) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : "Undated";
}

function Figure({ photo, large = false }: { photo: StoryDiscoveryPhoto; large?: boolean }) {
  return (
    <figure className={large ? "story-discovery-opening" : undefined}>
      <img src={photo.src} alt={photo.alt || photo.filename} loading={large ? undefined : "lazy"} />
      <figcaption>
        {formatDate(photo)}
        {photo.placeLabel ? ` · ${photo.placeLabel}` : ""}
      </figcaption>
    </figure>
  );
}

/**
 * Story Discovery: AI-assisted, curator-decided. Everything here is a read-only proposal held in memory;
 * approving never publishes or changes Story selections, the archive, anchors or match history.
 */
export function StoryDiscovery({ photos, matchResults, onViewStory, onClose }: StoryDiscoveryProps) {
  const proposals = useMemo(() => buildStoryProposals(photos, matchResults), [photos, matchResults]);
  const [status, setStatus] = useState<Record<string, ProposalStatus>>({});
  const [replacements, setReplacements] = useState<Record<string, Record<string, RankedPhoto>>>({});
  const [replacing, setReplacing] = useState<{ proposalId: string; photoId: string } | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function currentSequence(proposal: StoryProposal): RankedPhoto[] {
    const swaps = replacements[proposal.id] ?? {};
    return proposal.sequence.map((item) => swaps[item.photo.id] ?? item);
  }

  function renderProposal(proposal: StoryProposal) {
    const state = status[proposal.id] ?? "draft";
    const sequence = currentSequence(proposal);
    const [opening, ...rest] = sequence;
    const pair = findThenNow(
      sequence.map((item) => item.photo),
      matchResults
    );
    const swapped = new Set(Object.values(replacements[proposal.id] ?? {}).map((item) => item.photo.id));
    const available = proposal.shortlist.filter((item) => !sequence.some((used) => used.photo.id === item.photo.id));

    return (
      <article key={proposal.id} className="story-discovery-proposal" data-testid={`story-proposal-${proposal.id}`} data-status={state}>
        <p className="story-discovery-status" data-testid={`story-proposal-status-${proposal.id}`}>
          {STATUS_LABEL[state]}
        </p>
        <h2>{proposal.title}</h2>
        <p className="story-discovery-rationale">
          <em>Suggestion:</em> {proposal.rationale}
        </p>

        {state === "skipped" ? null : (
          <>
            <Figure photo={opening.photo} large />
            <p className="story-discovery-why">{opening.reasons.join(" · ") || "Chosen as the opening for its place in the sequence."}</p>

            <div className="story-discovery-grid">
              {rest.map((item) => (
                <div key={item.photo.id} className="story-discovery-cell" data-testid={`story-photo-${item.photo.id}`}>
                  <Figure photo={item.photo} />
                  <p className="story-discovery-why">{item.reasons.join(" · ")}</p>
                  {state === "draft" && available.length > 0 ? (
                    <button
                      type="button"
                      className="story-discovery-link"
                      onClick={() => setReplacing({ proposalId: proposal.id, photoId: item.photo.id })}
                    >
                      Replace image
                    </button>
                  ) : null}
                  {replacing?.proposalId === proposal.id && replacing.photoId === item.photo.id ? (
                    <div className="story-discovery-shortlist" data-testid="story-shortlist">
                      {available.map((candidate) => (
                        <button
                          key={candidate.photo.id}
                          type="button"
                          data-testid={`story-replace-with-${candidate.photo.id}`}
                          onClick={() => {
                            const original = proposal.sequence.find(
                              (entry) => entry.photo.id === item.photo.id || replacements[proposal.id]?.[entry.photo.id]?.photo.id === item.photo.id
                            );

                            if (original) {
                              setReplacements((current) => ({
                                ...current,
                                [proposal.id]: { ...(current[proposal.id] ?? {}), [original.photo.id]: candidate },
                              }));
                            }

                            setReplacing(null);
                          }}
                        >
                          <img src={candidate.photo.src} alt={candidate.photo.alt || candidate.photo.filename} />
                          <span>{formatDate(candidate.photo)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            {pair ? (
              <div className="story-discovery-thennow" data-testid={`story-thennow-${proposal.id}`}>
                <h3>Then and now</h3>
                <div className="story-discovery-pair">
                  <Figure photo={pair.before} />
                  <Figure photo={pair.after} />
                </div>
                <p className="story-discovery-why">
                  {pair.yearsApart} years apart. Both carry a curator-approved match for this place sharing: {pair.sharedFeatures.join(", ")}.
                </p>
              </div>
            ) : null}

            {swapped.size > 0 ? <p className="story-discovery-why">{swapped.size} photograph(s) replaced by the curator.</p> : null}
          </>
        )}

        <div className="story-discovery-actions">
          {state === "draft" ? (
            <>
              <button type="button" data-testid={`story-approve-${proposal.id}`} onClick={() => setStatus((c) => ({ ...c, [proposal.id]: "approved" }))}>
                Approve
              </button>
              <button type="button" data-testid={`story-skip-${proposal.id}`} onClick={() => setStatus((c) => ({ ...c, [proposal.id]: "skipped" }))}>
                Skip
              </button>
            </>
          ) : (
            <button type="button" className="story-discovery-link" onClick={() => setStatus((c) => ({ ...c, [proposal.id]: "draft" }))}>
              Back to draft
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="story-discovery" data-testid="story-discovery" role="dialog" aria-modal="true" aria-labelledby="story-discovery-title">
      <div className="story-discovery-inner">
        <button type="button" className="story-discovery-close" data-testid="story-discovery-close" onClick={onClose}>
          Close
        </button>

        <header>
          <p className="story-discovery-eyebrow">Story Discovery</p>
          <h1 id="story-discovery-title">What could the Story say next?</h1>
          <p className="story-discovery-note" data-testid="story-discovery-guard">
            Story Discovery groups photographs from one place across several years. Existing Story selections may appear as context, but every proposal must add at least two new photographs and include a stored visual clue.
            A reviewed photo match strengthens the connection between years; if none exists, the missing evidence is stated. These are drafts, not decisions. No photographs were analysed just now.
          </p>
          <button type="button" className="story-discovery-link" data-testid="story-discovery-view-story" onClick={onViewStory}>
            View in A Courtyard's Story
          </button>
        </header>

        {proposals.length === 0 ? (
          <p className="story-discovery-empty" data-testid="story-discovery-empty">
            No candidate sequence meets the current criteria yet. A proposal needs at least two unselected photographs from one assigned place across multiple years, three or more years overall, and a stored visual clue. Existing Story selections can provide context.
          </p>
        ) : (
          proposals.map(renderProposal)
        )}
      </div>
    </div>
  );
}
