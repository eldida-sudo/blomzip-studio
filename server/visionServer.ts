import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { buildPlaceMatchInstructions, buildPlaceSignatureInstructions } from "./placeMatchPrompt";
import {
  describePlaceMatchViolation,
  describePlaceSignatureViolation,
  enforcePlaceSignature,
  parsePlaceSignature,
  type PlaceSignature,
} from "./placeMatchContract";

const app = express();
const port = Number(process.env.VISION_SERVER_PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: "40mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000,
  maxRetries: 0,
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/vision/analyze", async (req, res) => {
  try {
    const {
      filename,
      imageDataUrl,
      canonicalPlaceId,
      canonicalPlaceName,
    } = req.body ?? {};

    const placeContext = canonicalPlaceId
      ? `The archive has a human-confirmed canonical place for this photograph: ${canonicalPlaceName ?? canonicalPlaceId} (${canonicalPlaceId}). Treat this as trusted archive context. Do not reclassify or contradict the confirmed place. Do not emit place_candidate for this photograph. `
      : `This photograph does not yet have a human-confirmed canonical place. You may emit place_candidate when visually justified. `;

    console.log("Vision place context:", {
      filename,
      canonicalPlaceId,
      canonicalPlaceName,
    });

    if (!filename || !imageDataUrl) {
      return res.status(400).json({
        error: "filename and imageDataUrl are required",
      });
    }

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Analyze this courtyard photograph specifically for the Blomzip archive. " +
                "Return JSON only with a signals array. " +
                "Only report conclusions that are visually supported by this image; do not invent history or context. " +
                "Use these Blomzip signal types when relevant: " +
                "place_candidate, plant_or_subject, story_potential, hero_potential, before_after_potential, visual_character. " +
                "Also report person-detected, face-detected, or readable-registration-plate when an identifiable person/face or readable vehicle registration plate is visibly present. " +
                placeContext +
                "For place_candidate, prefer one of the current canonical places when visually justified: " +
                "parking, raised-bed, seating-area, central-lawn, shade-corner, rock-garden, garden-border, house-wall, entrance. " +
                "If none is sufficiently supported, say that instead of forcing a place. " +
                "For story_potential, explain the visible reason for the recommendation. " +
                "For hero_potential, evaluate whether the image can carry a place or story visually on its own. " +
                "Consider focal clarity, composition, light, atmosphere or visual character, place legibility, editorial usability, and emotional connection. " +
                "Light means photographic light quality: exposure, tonal separation, highlight and shadow control, subject readability, and whether the light helps the photograph work visually. " +
                "Backlight, flare, blown highlights, blocked shadows, harsh or uneven exposure should reduce Light when they hurt photographic quality. " +
                "An image may have high Atmosphere but low Light. Documentary value, such as showing where sunlight falls in the courtyard, must not increase Light. " +
                "Use the full scoring range. Weak photographic qualities should commonly score around 0.1–0.4 rather than clustering around 0.6–0.8. " +
                "Strong atmosphere, story value or emotional connection must not automatically raise Composition, Focal clarity or Light. " +
                "Place legibility only measures how clearly the place can be understood; it does not by itself make an image a Place hero. " +
                "Hero score should remain low when core photographic qualities are weak even if atmosphere, emotional connection or place legibility are high. " +
                "Emotional connection means the potential to create a felt response or sense of connection through recognition, tenderness, humour, wonder, vulnerability, tension, frustration, loss, beauty, memory, or another visually supported quality. " +
                "Emotional connection does not need to be positive: familiar difficulties, imperfection, weeds, seasonal decline, struggling plants, damage or decay may strengthen a Hero when visually supported. " +
                "Do not equate conventional beauty with Hero quality. Do not invent emotions, events or history that are not visually supported. " +
                "A Blomzip Hero should not only show the courtyard well; it should give the viewer a reason to care about it and be visually strong enough to lead. " +
                "When recommending hero_potential, state whether the visible evidence makes it more suitable as a place hero, story hero, both, or neither, and explain why. Use neither for useful archive, documentation or story images that are not visually strong enough to lead. Reserve both for images that are genuinely strong in both roles. " +
                "For before_after_potential, only recommend it when the image clearly documents spatial structure or change-comparable features. " +
                "Each signal must contain signal, confidence from 0 to 1, and detail.",
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "low",
            },
          ],
        },
      ],
      reasoning: { effort: "minimal" },
      text: {
        format: {
          type: "json_schema",
          name: "blomzip_vision_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              signals: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    signal: {
                      type: "string",
                      enum: [
                        "place_candidate",
                        "plant_or_subject",
                        "story_potential",
                        "hero_potential",
                        "before_after_potential",
                        "visual_character",
                        "person-detected",
                        "face-detected",
                        "readable-registration-plate"
                      ]
                    },
                    confidence: {
                      type: "number",
                      minimum: 0,
                      maximum: 1
                    },
                    detail: {
                      type: "string"
                    }
                  },
                  required: ["signal", "confidence", "detail"],
                  additionalProperties: false
                }
              },
              hero_assessment: {
                type: "object",
                properties: {
                  score: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                  },
                  role: {
                    type: "string",
                    enum: ["place_hero", "story_hero", "both", "neither"]
                  },
                  focal_clarity: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                  },
                  composition: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                  },
                  light: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                  },
                  atmosphere: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                  },
                  place_legibility: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                  },
                  editorial_usability: {
                    type: "number",
                    minimum: 0,
                    maximum: 1
                  },
                  emotional_connection: {
                    type: "object",
                    properties: {
                      score: {
                        type: "number",
                        minimum: 0,
                        maximum: 1
                      },
                      quality: {
                        type: "string"
                      },
                      evidence: {
                        type: "string"
                      }
                    },
                    required: ["score", "quality", "evidence"],
                    additionalProperties: false
                  },
                  reason: {
                    type: "string"
                  }
                },
                required: [
                  "score",
                  "role",
                  "focal_clarity",
                  "composition",
                  "light",
                  "atmosphere",
                  "place_legibility",
                  "editorial_usability",
                  "emotional_connection",
                  "reason"
                ],
                additionalProperties: false
              }
            },
            required: ["signals", "hero_assessment"],
            additionalProperties: false
          }
        }
      },
      max_output_tokens: 8000,
    });

    if (response.status === "incomplete") {
      return res.status(502).json({
        error: `Vision response incomplete: ${response.incomplete_details?.reason ?? "unknown reason"}`,
        usage: response.usage,
      });
    }

    if (!response.output_text) {
      return res.status(502).json({
        error: "Vision response contained no output text.",
        usage: response.usage,
      });
    }

    res.json({
      filename,
      outputText: response.output_text,
      usage: response.usage,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error instanceof Error ? error.message : "Vision analysis failed",
    });
  }
});


app.post("/api/vision/compare-map", async (req, res) => {
  try {
    const {
      photoFilename,
      photoImageDataUrl,
      mapFilename,
      mapImageDataUrl,
    } = req.body ?? {};

    if (!photoFilename || !photoImageDataUrl || !mapFilename || !mapImageDataUrl) {
      return res.status(400).json({
        error: "photoFilename, photoImageDataUrl, mapFilename and mapImageDataUrl are required",
      });
    }

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Compare these two representations of the same courtyard for Blomzip. " +
              "The first image is a real balcony photograph. The second is the illustrated Living Map. " +
              "Only report visually supported observations. " +
              "Identify shared spatial features, objects visible only in the photo, objects visible only in the map, " +
              "and whether the viewpoint and spatial layout are consistent. " +
              "Pay particular attention to concrete details such as cars, animals, furniture, planters and people."
          },
          {
            type: "input_image",
            image_url: photoImageDataUrl,
            detail: "high",
          },
          {
            type: "input_image",
            image_url: mapImageDataUrl,
            detail: "high",
          },
        ],
      }],
      reasoning: { effort: "low" },
      max_output_tokens: 1600,
    });

    res.json({
      photoFilename,
      mapFilename,
      outputText: response.output_text,
      usage: response.usage,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Vision comparison failed",
    });
  }
});

const MAX_PLACE_ANCHORS = 8;
const MIN_PLACE_ANCHORS = 3;

function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(jpeg|png);base64,/.test(value);
}

const stringArraySchema = { type: "array", items: { type: "string" } } as const;

app.post("/api/vision/place-signature", async (req, res) => {
  try {
    const { placeName, anchorImageDataUrls } = req.body ?? {};

    if (typeof placeName !== "string" || !placeName.trim()) {
      return res.status(400).json({ error: "placeName is required" });
    }

    if (
      !Array.isArray(anchorImageDataUrls) ||
      anchorImageDataUrls.length < MIN_PLACE_ANCHORS ||
      anchorImageDataUrls.length > MAX_PLACE_ANCHORS ||
      !anchorImageDataUrls.every(isImageDataUrl)
    ) {
      return res.status(400).json({
        error: `anchorImageDataUrls must contain ${MIN_PLACE_ANCHORS}-${MAX_PLACE_ANCHORS} JPEG or PNG data URLs`,
      });
    }

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildPlaceSignatureInstructions(placeName.trim(), anchorImageDataUrls.length) },
            ...anchorImageDataUrls.flatMap((url: string, index: number) => [
              { type: "input_text" as const, text: `REFERENCE ${index + 1}:` },
              { type: "input_image" as const, image_url: url, detail: "high" as const },
            ]),
          ],
        },
      ],
      reasoning: { effort: "low" },
      max_output_tokens: 1600,
      text: {
        format: {
          type: "json_schema",
          name: "blomzip_place_signature",
          strict: true,
          schema: {
            type: "object",
            properties: { core: stringArraySchema, supporting: stringArraySchema, contextual: stringArraySchema },
            required: ["core", "supporting", "contextual"],
            additionalProperties: false,
          },
        },
      },
    });

    if (response.status === "incomplete") {
      return res.status(502).json({
        error: `Vision response incomplete: ${response.incomplete_details?.reason ?? "unknown reason"}`,
        usage: response.usage,
      });
    }

    if (!response.output_text) {
      return res.status(502).json({ error: "Vision response contained no output text.", usage: response.usage });
    }

    const parsed = parsePlaceSignature(response.output_text);

    if ("violation" in parsed) {
      console.error("Place-signature contract violation:", { violation: parsed.violation, outputText: response.output_text });
      return res.status(502).json({
        error: `Place-signature response violated the schema: ${parsed.violation}.`,
        rawOutputText: response.output_text.slice(0, 2000),
        usage: response.usage,
      });
    }

    console.log("Place signature derived:", { placeName: placeName.trim(), signature: parsed.signature });
    res.json({ signature: parsed.signature, usage: response.usage });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Place signature derivation failed",
    });
  }
});

app.post("/api/vision/match-place", async (req, res) => {
  try {
    const { placeName, candidateImageDataUrl, anchorImageDataUrls, signature } = req.body ?? {};

    if (typeof placeName !== "string" || !placeName.trim()) {
      return res.status(400).json({ error: "placeName is required" });
    }

    if (!isImageDataUrl(candidateImageDataUrl)) {
      return res.status(400).json({ error: "candidateImageDataUrl must be a JPEG or PNG data URL" });
    }

    if (
      !Array.isArray(anchorImageDataUrls) ||
      anchorImageDataUrls.length < MIN_PLACE_ANCHORS ||
      anchorImageDataUrls.length > MAX_PLACE_ANCHORS ||
      !anchorImageDataUrls.every(isImageDataUrl)
    ) {
      return res.status(400).json({
        error: `anchorImageDataUrls must contain ${MIN_PLACE_ANCHORS}-${MAX_PLACE_ANCHORS} JPEG or PNG data URLs`,
      });
    }

    const signatureViolation = describePlaceSignatureViolation(signature);

    if (signatureViolation) {
      return res.status(400).json({ error: `Invalid place signature: ${signatureViolation}.` });
    }

    const placeSignature = signature as PlaceSignature;

    const content: Array<
      { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" }
    > = [
      {
        type: "input_text",
        text: buildPlaceMatchInstructions(placeName.trim(), anchorImageDataUrls.length, placeSignature),
      },
      ...anchorImageDataUrls.flatMap((url: string, index: number) => [
        { type: "input_text" as const, text: `REFERENCE ${index + 1}:` },
        { type: "input_image" as const, image_url: url, detail: "high" as const },
      ]),
      { type: "input_text", text: "CANDIDATE:" },
      { type: "input_image", image_url: candidateImageDataUrl, detail: "high" },
    ];

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: [{ role: "user", content }],
      reasoning: { effort: "low" },
      max_output_tokens: 1600,
      text: {
        format: {
          type: "json_schema",
          name: "blomzip_place_match",
          strict: true,
          schema: {
            type: "object",
            properties: {
              classification: { type: "string", enum: ["SAME_PLACE", "NEARBY_CONTEXT", "DIFFERENT_PLACE"] },
              score: { type: "number" },
              reason: { type: "string" },
              core_matched: stringArraySchema,
              supporting_matched: stringArraySchema,
            },
            required: ["classification", "score", "reason", "core_matched", "supporting_matched"],
            additionalProperties: false,
          },
        },
      },
    });

    if (response.status === "incomplete") {
      return res.status(502).json({
        error: `Vision response incomplete: ${response.incomplete_details?.reason ?? "unknown reason"}`,
        usage: response.usage,
      });
    }

    if (!response.output_text) {
      return res.status(502).json({ error: "Vision response contained no output text.", usage: response.usage });
    }

    const violation = describePlaceMatchViolation(response.output_text);

    if (violation) {
      console.error("Place-match contract violation:", {
        violation,
        status: response.status,
        outputTypes: response.output?.map((item) => item.type),
        outputText: response.output_text,
      });
      return res.status(502).json({
        error: `Place-match response violated the schema: ${violation}.`,
        rawOutputText: response.output_text.slice(0, 2000),
        usage: response.usage,
      });
    }

    const { result, dropped } = enforcePlaceSignature(response.output_text, placeSignature);

    if (dropped.length > 0) {
      console.warn("Place-match dropped features outside the signature:", dropped);
    }

    res.json({ outputText: JSON.stringify(result), usage: response.usage });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Place matching failed",
    });
  }
});

app.listen(port, () => {
  console.log(`Blomzip vision proxy running on http://localhost:${port}`);
});
  