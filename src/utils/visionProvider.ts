import type { VisualAnalysisResult, VisualEvidenceSignal } from "../models/blomzip";

export const VISION_ANALYSIS_VERSION = 1;

export interface VisionAnalysisRequest {
  imageRecordId: string;
  filename: string;
}

// Provider boundary: real image analysis must be implemented behind this interface
// so the rest of the app (and tests) never depend on a specific vision API.
export interface VisionProvider {
  readonly id: string;
  analyzeImage(request: VisionAnalysisRequest): Promise<VisualAnalysisResult>;
}

/**
 * Default provider when no real vision API is wired up. It never fabricates visual
 * understanding - it fails clearly so the app cannot pass off mock data as genuine analysis.
 *
 * Wiring a real provider (e.g. an OpenAI/Anthropic-style multimodal endpoint) requires a
 * backend proxy that holds the API credential server-side: this is a browser-only SPA, and
 * embedding a vision API key in client code would leak it to every visitor.
 */
export class NotConfiguredVisionProvider implements VisionProvider {
  readonly id = "vision-provider-not-configured";

  async analyzeImage(_request: VisionAnalysisRequest): Promise<VisualAnalysisResult> {
    throw new Error(
      "No genuine image-analysis provider is configured. Real visual analysis requires a backend proxy " +
        "that holds a vision-capable multimodal API credential server-side and forwards the image bytes " +
        "to that provider; the API key must not be embedded in browser code."
    );
  }
}

const DEFAULT_FIXTURE_SIGNALS: VisualEvidenceSignal[] = [
  {
    signal: "human-activity",
    confidence: 0.92,
    detail: "Two people are interacting outdoors.",
    provider: "",
    analysisVersion: VISION_ANALYSIS_VERSION,
  },
  {
    signal: "spatial-overview",
    confidence: 0.88,
    detail: "The frame shows several courtyard areas and their spatial relationship.",
    provider: "",
    analysisVersion: VISION_ANALYSIS_VERSION,
  },
];

/**
 * Deterministic development/test adapter. Never call this a genuine visual-analysis result -
 * it exists only so persistence, Story integration, and UI can be exercised without a paid API.
 */
export class FixtureVisionProvider implements VisionProvider {
  readonly id = "fixture-vision-provider-dev";

  private readonly fixturesByFilename: Record<string, VisualEvidenceSignal[]>;

  constructor(fixturesByFilename: Record<string, VisualEvidenceSignal[]> = {}) {
    this.fixturesByFilename = fixturesByFilename;
  }

  async analyzeImage(request: VisionAnalysisRequest): Promise<VisualAnalysisResult> {
    const signals = this.fixturesByFilename[request.filename] ?? DEFAULT_FIXTURE_SIGNALS;

    return {
      signals: signals.map((signal) => ({ ...signal, provider: this.id, analysisVersion: VISION_ANALYSIS_VERSION })),
      provider: this.id,
      generatedAt: new Date().toISOString(),
      analysisVersion: VISION_ANALYSIS_VERSION,
    };
  }
}

/**
 * Selects the active provider. Defaults to the safe "not configured" provider so no image is
 * ever sent anywhere automatically. Set VITE_VISION_ENGINE_MODE=fixture to exercise the full
 * pipeline locally with deterministic dev data before a real provider is wired in.
 */
export function createVisionProvider(): VisionProvider {
  const mode = import.meta.env?.VITE_VISION_ENGINE_MODE;

  if (mode === "fixture") {
    return new FixtureVisionProvider();
  }

  return new NotConfiguredVisionProvider();
}
