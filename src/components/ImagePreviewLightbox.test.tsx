/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewThumbnailButton, useImagePreview } from "./ImagePreviewLightbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reviewSpy = vi.fn();

function Harness({ src = "blob:full" }: { src?: string }) {
  const { open, lightbox } = useImagePreview();
  return (
    <div>
      <PreviewThumbnailButton
        target={{ src, filename: "one.jpg", placeLabel: "Seating area", onOpenInReview: reviewSpy }}
        onOpen={open}
      >
        <img src="blob:thumb" alt="" />
      </PreviewThumbnailButton>
      {lightbox}
    </div>
  );
}

describe("shared image preview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    reviewSpy.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const openPreview = () => {
    act(() => {
      container.querySelector<HTMLButtonElement>(".image-preview-trigger")!.click();
    });
  };

  it("opens with filename, place and described image, without navigating", () => {
    act(() => root.render(<Harness />));
    openPreview();

    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    expect(container.querySelector("[data-testid='image-preview-filename']")?.textContent).toBe("one.jpg");
    expect(container.querySelector("[data-testid='image-preview-place']")?.textContent).toContain("Seating area");
    expect(container.querySelector("[data-testid='image-preview-image']")?.getAttribute("alt")).toBe("one.jpg");
    expect(reviewSpy).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("Close");
  });

  it("closes via Escape, Close button and backdrop but not dialog clicks", () => {
    act(() => root.render(<Harness />));

    openPreview();
    act(() => {
      container.querySelector<HTMLElement>("[data-testid='image-preview-dialog']")!.click();
    });
    expect(container.querySelector("[role='dialog']")).not.toBeNull();

    act(() => {
      container.querySelector<HTMLElement>("[data-testid='image-preview-backdrop']")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();

    openPreview();
    act(() => container.querySelector<HTMLButtonElement>(".image-preview-close")!.click());
    expect(container.querySelector("[role='dialog']")).toBeNull();

    openPreview();
    act(() => container.querySelector<HTMLElement>("[data-testid='image-preview-backdrop']")!.click());
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("falls back gracefully for placeholder sources and offers explicit review action", () => {
    act(() => root.render(<Harness src="data:image/svg+xml;charset=utf-8,x" />));
    openPreview();

    expect(container.querySelector("[data-testid='image-preview-unavailable']")).not.toBeNull();
    expect(container.querySelector("[data-testid='image-preview-image']")).toBeNull();

    act(() => container.querySelector<HTMLButtonElement>("[data-testid='image-preview-open-review']")!.click());
    expect(reviewSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });
});
