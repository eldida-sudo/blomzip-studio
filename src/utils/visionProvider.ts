import type {
  HeroAssessment,
  PlaceMatchClassification,
  HeroAssessmentRole,
  VisualAnalysisResult,
  VisualEvidenceSignal,
  VisualEvidenceSignalId,
} from "../models/blomzip";

export const VISION_ANALYSIS_VERSION = 1;

const VISUAL_EVIDENCE_SIGNAL_IDS: ReadonlySet<VisualEvidenceSignalId> = new Set([
  "human-activity",
  "spatial-overview",
  "place-legibility",
  "visible-change-cue",
  "vegetation-state",
  "negative-space",
  "focal-structure",
  "person-detected",
  "face-detected",
  "readable-registration-plate",
]);

function isVisualEvidenceSignalId(value: string): value is VisualEvidenceSignalId {
  return VISUAL_EVIDENCE_SIGNAL_IDS.has(value as VisualEvidenceSignalId);
}

const HERO_ASSESSMENT_ROLES: ReadonlySet<HeroAssessmentRole> = new Set([
  "place_hero",
  "story_hero",
  "both",
  "neither",
]);

function isHeroAssessmentRole(value: string): value is HeroAssessmentRole {
  return HERO_ASSESSMENT_ROLES.has(value as HeroAssessmentRole);
}

export const HERO_ROLE_MIN_SCORE = 0.5;

export function applyHeroRoleGate(
  score: number,
  role: HeroAssessmentRole
): HeroAssessmentRole {
  return score < HERO_ROLE_MIN_SCORE ? "neither" : role;
}

export interface VisionAnalysisRequest {
  imageRecordId: string;
  filename: string;
  imageUrl?: string;
  canonicalPlaceId?: string;
  canonicalPlaceName?: string;
}

export interface PlaceSignature {
  core: string[];
  supporting: string[];
  contextual: string[];
}

export interface PlaceSignatureRequest {
  placeName: string;
  anchorImageDataUrls: string[];
}

export interface PlaceMatchRequest {
  placeId: string;
  signature: PlaceSignature;
  placeName: string;
  imageRecordId: string;
  candidateImageDataUrl: string;
  anchorImageDataUrls: string[];
}

export interface PlaceMatchOutcome {
  placeId: string;
  imageRecordId: string;
  classification: PlaceMatchClassification;
  matchedFeatures: string[];
  score: number;
  reason: string;
  provider: string;
  analysisVersion: number;
}

const PLACE_MATCH_REASON_MAX_LENGTH = 280;
export const MIN_SAME_PLACE_FEATURES = 2;

const PLACE_MATCH_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "SAME_PLACE",
  "NEARBY_CONTEXT",
  "DIFFERENT_PLACE",
]);

// Score is secondary to classification, so it is bounded by the class it belongs to.
const PLACE_MATCH_SCORE_CEILING: Record<PlaceMatchClassification, number> = {
  SAME_PLACE: 1,
  NEARBY_CONTEXT: 0.5,
  DIFFERENT_PLACE: 0.2,
};

/**
 * Strictly parses the Vision model's match output. Throws instead of fabricating a result.
 * A SAME_PLACE claim backed by fewer than two distinct place-defining features is downgraded
 * to NEARBY_CONTEXT, so the model cannot grant it on a single feature or on context alone.
 */
export function parsePlaceMatchOutput(
  outputText: string,
  context: { placeId: string; imageRecordId: string; provider: string }
): PlaceMatchOutcome {
  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("Vision proxy returned invalid place-match JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Vision proxy returned an invalid place-match result.");
  }

  const { classification, score, reason, matched_features } = parsed as {
    classification?: unknown;
    score?: unknown;
    reason?: unknown;
    matched_features?: unknown;
  };

  if (typeof classification !== "string" || !PLACE_MATCH_CLASSIFICATIONS.has(classification)) {
    throw new Error("Place-match result did not contain a valid classification.");
  }

  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("Place-match result did not contain a numeric score.");
  }

  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("Place-match result did not contain a visual reason.");
  }

  if (!Array.isArray(matched_features) || !matched_features.every((feature) => typeof feature === "string")) {
    throw new Error("Place-match result did not contain matched_features.");
  }

  const seen = new Set<string>();
  const matchedFeatures: string[] = [];

  for (const feature of matched_features as string[]) {
    const trimmed = feature.trim();
    const key = trimmed.toLowerCase();

    if (trimmed && !seen.has(key)) {
      seen.add(key);
      matchedFeatures.push(trimmed);
    }
  }

  let finalClassification = classification as PlaceMatchClassification;

  if (finalClassification === "SAME_PLACE" && matchedFeatures.length < MIN_SAME_PLACE_FEATURES) {
    finalClassification = "NEARBY_CONTEXT";
  }

  return {
    placeId: context.placeId,
    imageRecordId: context.imageRecordId,
    classification: finalClassification,
    matchedFeatures,
    score: Math.min(PLACE_MATCH_SCORE_CEILING[finalClassification], Math.max(0, score)),
    reason: reason.trim().slice(0, PLACE_MATCH_REASON_MAX_LENGTH),
    provider: context.provider,
    analysisVersion: VISION_ANALYSIS_VERSION,
  };
}

// Provider boundary: real image analysis must be implemented behind this interface
// so the rest of the app (and tests) never depend on a specific vision API.
export interface VisionProvider {
  readonly id: string;
  analyzeImage(request: VisionAnalysisRequest): Promise<VisualAnalysisResult>;
  derivePlaceSignature?(request: PlaceSignatureRequest): Promise<PlaceSignature>;
  matchPlaceCandidate?(request: PlaceMatchRequest): Promise<PlaceMatchOutcome>;
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

  async matchPlaceCandidate(_request: PlaceMatchRequest): Promise<PlaceMatchOutcome> {
    throw new Error(PLACE_MATCH_UNAVAILABLE);
  }
}

const PLACE_MATCH_UNAVAILABLE =
  "Place matching needs the genuine Vision proxy provider (VITE_VISION_ENGINE_MODE=proxy). " +
  "No match was fabricated.";

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

  async matchPlaceCandidate(_request: PlaceMatchRequest): Promise<PlaceMatchOutcome> {
    throw new Error(PLACE_MATCH_UNAVAILABLE);
  }

  constructor(fixturesByFilename: Record<string, VisualEvidenceSignal[]> = {}) {
    this.fixturesByFilename = fixturesByFilename;
  }

  async analyzeImage(request: VisionAnalysisRequest): Promise<VisualAnalysisResult> {
    const signals = this.fixturesByFilename[request.filename] ?? DEFAULT_FIXTURE_SIGNALS;

    return {
      signals: signals.map((signal) => ({
        ...signal,
        provider: this.id,
        analysisVersion: VISION_ANALYSIS_VERSION,
      })),
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
async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Could not read image for visual analysis: ${response.status}`);
  }

  const blob = await response.blob();

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not convert image to data URL."));
      }
    };

    reader.onerror = () => reject(new Error("Could not read image data."));
    reader.readAsDataURL(blob);
  });
}

export class ProxyVisionProvider implements VisionProvider {
  readonly id = "blomzip-vision-proxy";

  async derivePlaceSignature(request: PlaceSignatureRequest): Promise<PlaceSignature> {
    const response = await fetch("/api/vision/place-signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeName: request.placeName, anchorImageDataUrls: request.anchorImageDataUrls }),
    });

    const responseText = await response.text();
    let payload: { error?: string; signature?: unknown };

    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(`Vision proxy returned invalid signature JSON (status ${response.status}): ${responseText.slice(0, 160)}`);
    }

    if (!response.ok) {
      throw new Error(payload.error ?? `Place signature derivation failed with status ${response.status}.`);
    }

    const signature = payload.signature as Partial<PlaceSignature> | undefined;
    const isStrings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");

    if (!signature || !isStrings(signature.core) || !isStrings(signature.supporting) || !isStrings(signature.contextual)) {
      throw new Error("Vision proxy response did not contain a valid place signature.");
    }

    return signature as PlaceSignature;
  }

  async matchPlaceCandidate(request: PlaceMatchRequest): Promise<PlaceMatchOutcome> {
    const response = await fetch("/api/vision/match-place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placeName: request.placeName,
        candidateImageDataUrl: request.candidateImageDataUrl,
        anchorImageDataUrls: request.anchorImageDataUrls,
        signature: request.signature,
      }),
    });

    const responseText = await response.text();

    if (!responseText) {
      throw new Error(`Vision proxy returned an empty HTTP response (status ${response.status}).`);
    }

    let payload: { error?: string; outputText?: string };

    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Vision proxy returned invalid HTTP JSON (status ${response.status}): ${responseText.slice(0, 160)}`
      );
    }

    if (!response.ok) {
      throw new Error(payload.error ?? `Place matching failed with status ${response.status}.`);
    }

    if (typeof payload.outputText !== "string") {
      throw new Error("Vision proxy response did not contain outputText.");
    }

    return parsePlaceMatchOutput(payload.outputText, {
      placeId: request.placeId,
      imageRecordId: request.imageRecordId,
      provider: this.id,
    });
  }

  async analyzeImage(request: VisionAnalysisRequest): Promise<VisualAnalysisResult> {
    if (!request.imageUrl) {
      throw new Error("No image data is available for visual analysis.");
    }

    const imageDataUrl = await imageUrlToDataUrl(request.imageUrl);

    const response = await fetch("/api/vision/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: request.filename,
        imageDataUrl,
        canonicalPlaceId: request.canonicalPlaceId,
        canonicalPlaceName: request.canonicalPlaceName,
      }),
    });

    const responseText = await response.text();

    if (!responseText) {
      throw new Error(
        `Vision proxy returned an empty HTTP response (status ${response.status}).`
      );
    }

    let payload: {
      error?: string;
      outputText?: string;
      [key: string]: unknown;
    };

    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Vision proxy returned invalid HTTP JSON (status ${response.status}): ${responseText.slice(0, 160)}`
      );
    }

    if (!response.ok) {
      throw new Error(
        payload.error ?? `Visual analysis failed with status ${response.status}.`
      );
    }

    if (typeof payload.outputText !== "string") {
      throw new Error("Vision proxy response did not contain outputText.");
    }

    let parsed: {
      signals?: Array<{
        signal: string;
        confidence: number;
        detail: string;
      }>;
      hero_assessment?: {
        score: number;
        role: string;
        focal_clarity: number;
        composition: number;
        light: number;
        atmosphere: number;
        place_legibility: number;
        editorial_usability: number;
        emotional_connection: {
          score: number;
          quality: string;
          evidence: string;
        };
        reason: string;
      };
    };

    try {
      parsed = JSON.parse(payload.outputText);
    } catch {
      throw new Error("Vision proxy returned invalid JSON.");
    }

    const signals = Array.isArray(parsed.signals) ? parsed.signals : [];

    const validatedSignals: VisualEvidenceSignal[] = signals
      .filter((signal) => isVisualEvidenceSignalId(signal.signal))
      .map((signal): VisualEvidenceSignal => ({
        signal: signal.signal as VisualEvidenceSignalId,
        confidence: signal.confidence,
        detail: signal.detail,
        provider: this.id,
        analysisVersion: VISION_ANALYSIS_VERSION,
      }));

    let heroAssessment: HeroAssessment | undefined;

    if (
      parsed.hero_assessment &&
      isHeroAssessmentRole(parsed.hero_assessment.role)
    ) {
      heroAssessment = {
        score: parsed.hero_assessment.score,
        role: applyHeroRoleGate(
          parsed.hero_assessment.score,
          parsed.hero_assessment.role
        ),
        focalClarity: parsed.hero_assessment.focal_clarity,
        composition: parsed.hero_assessment.composition,
        light: parsed.hero_assessment.light,
        atmosphere: parsed.hero_assessment.atmosphere,
        placeLegibility: parsed.hero_assessment.place_legibility,
        editorialUsability: parsed.hero_assessment.editorial_usability,
        emotionalConnection: {
          score: parsed.hero_assessment.emotional_connection.score,
          quality: parsed.hero_assessment.emotional_connection.quality,
          evidence: parsed.hero_assessment.emotional_connection.evidence,
        },
        reason: parsed.hero_assessment.reason,
      };
    }

    return {
      signals: validatedSignals,
      heroAssessment,
      provider: this.id,
      generatedAt: new Date().toISOString(),
      analysisVersion: VISION_ANALYSIS_VERSION,
    };
  }
}

/**
 * Selects the active provider.
 *
 * fixture = deterministic free development data
 * proxy = genuine visual analysis through the Blomzip backend proxy
 *
 * Any other value defaults safely to NotConfiguredVisionProvider.
 */
export function createVisionProvider(): VisionProvider {
  const mode = import.meta.env?.VITE_VISION_ENGINE_MODE;

  if (mode === "fixture") {
    return new FixtureVisionProvider();
  }

  if (mode === "proxy") {
    return new ProxyVisionProvider();
  }

  return new NotConfiguredVisionProvider();
}
