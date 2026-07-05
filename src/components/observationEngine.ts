import type { Observation } from "../models/blomzip";

export interface ObservationEngine {
  generateObservations(entryId: string): Observation[];
}

export class MockObservationEngine implements ObservationEngine {
  generateObservations(entryId: string): Observation[] {
    const templates = [
      { type: "Plant", value: "Flower", confidence: 0.98 },
      { type: "Ground", value: "Grass", confidence: 0.91 },
      { type: "Change", value: "Leaf fall", confidence: 0.87 },
      { type: "Season", value: "Blooming", confidence: 0.84 },
    ] as const;

    const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];

    return [
      {
        id: `observation-${entryId}-${Date.now()}`,
        entryId,
        type: selectedTemplate.type,
        confidence: selectedTemplate.confidence,
        source: "mock-ai",
        value: selectedTemplate.value,
        createdAt: new Date().toISOString(),
        reviewed: false,
      },
    ];
  }
}

export class FutureVisionObservationEngine implements ObservationEngine {
  generateObservations(_entryId: string): Observation[] {
    return [];
  }
}
