import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.VISION_SERVER_PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: "15mb" }));

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
                "Analyze this courtyard photograph for Blomzip. " +
                "Return JSON only with a signals array. " +
                "Only report visually supported signals. " +
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
      max_output_tokens: 300,
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

app.listen(port, () => {
  console.log(`Blomzip vision proxy running on http://localhost:${port}`);
});curl -X POST http://localhost:8787/api/vision/analyze \
  -H "Content-Type: application/json" \
  -d '{}'
  