import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.VISION_SERVER_PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: "40mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/vision/analyze", async (req, res) => {
  try {
    const { filename, imageDataUrl } = req.body ?? {};

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
                "For place_candidate, prefer one of the current canonical places when visually justified: " +
                "parking, raised-bed, seating-area, central-lawn, shade-corner, rock-garden, garden-border, house-wall, entrance. " +
                "If none is sufficiently supported, say that instead of forcing a place. " +
                "For story_potential and hero_potential, explain the visible reason for the recommendation. " +
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
      reasoning: { effort: "low" },
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
                        "visual_character"
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
              }
            },
            required: ["signals"],
            additionalProperties: false
          }
        }
      },
      max_output_tokens: 1200,
    });

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

app.listen(port, () => {
  console.log(`Blomzip vision proxy running on http://localhost:${port}`);
});
  