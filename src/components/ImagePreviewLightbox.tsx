import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ImagePreviewTarget {
  src?: string;
  filename: string;
  placeLabel?: string;
  alt?: string;
  // Optional explicit user action; opening the preview never navigates by itself.
  onOpenInReview?: () => void;
}

interface ImagePreviewLightboxProps {
  target: ImagePreviewTarget;
  onClose: () => void;
}

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

// Generated placeholders are SVG data URLs, not real photographs.
function isPlaceholderSource(src: string | undefined): boolean {
  return !src || src.startsWith("data:image/svg+xml");
}

export function ImagePreviewLightbox({ target, onClose }: ImagePreviewLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const unavailable = isPlaceholderSource(target.src) || failedSrc === target.src;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === "Tab") {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="image-preview-backdrop" data-testid="image-preview-backdrop" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        className="image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Photograph preview: ${target.filename}`}
        data-testid="image-preview-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="image-preview-close secondary-action" onClick={onClose}>
          Close
        </button>
        {unavailable ? (
          <p className="image-preview-unavailable" data-testid="image-preview-unavailable" role="status">
            Full-size image unavailable in this browser.
          </p>
        ) : (
          <img
            className="image-preview-image"
            data-testid="image-preview-image"
            src={target.src}
            alt={target.alt ?? target.filename}
            onError={() => setFailedSrc(target.src ?? null)}
          />
        )}
        <div className="image-preview-caption">
          <strong data-testid="image-preview-filename">{target.filename}</strong>
          {target.placeLabel ? (
            <span data-testid="image-preview-place">Place: {target.placeLabel}</span>
          ) : null}
          {target.onOpenInReview ? (
            <button
              type="button"
              className="secondary-action"
              data-testid="image-preview-open-review"
              onClick={() => {
                onClose();
                target.onOpenInReview?.();
              }}
            >
              Open in review
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Local state holder so opening a preview never touches page, filters or review state.
export function useImagePreview() {
  const [target, setTarget] = useState<ImagePreviewTarget | null>(null);
  const open = useCallback((next: ImagePreviewTarget) => setTarget(next), []);
  const close = useCallback(() => setTarget(null), []);
  const lightbox: ReactNode = target ? <ImagePreviewLightbox target={target} onClose={close} /> : null;

  return { open, lightbox };
}

interface PreviewThumbnailProps {
  target: ImagePreviewTarget;
  onOpen: (target: ImagePreviewTarget) => void;
  className?: string;
  testId?: string;
  children?: ReactNode;
}

export function PreviewThumbnailButton({ target, onOpen, className, testId, children }: PreviewThumbnailProps) {
  return (
    <button
      type="button"
      className={`image-preview-trigger${className ? ` ${className}` : ""}`}
      aria-label={`Preview larger: ${target.filename}`}
      title="Preview larger"
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(target);
      }}
    >
      {children}
    </button>
  );
}
