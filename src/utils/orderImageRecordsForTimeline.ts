import type { ImageRecord } from "../models/blomzip";
import { parseCaptureDate } from "./captureDate";

export type TimelineOrderingStrategy = "captureDate" | "filename";

export interface TimelineOrderingResult {
  orderedRecords: ImageRecord[];
  strategy: TimelineOrderingStrategy;
}

function normalizeCaptureDate(value?: string) {
  return parseCaptureDate(value)?.getTime();
}

export function orderImageRecordsForTimeline(records: ImageRecord[]): TimelineOrderingResult {
  const withDates = records.map((record, index) => ({
    record,
    index,
    dateValue: normalizeCaptureDate(record.captureDate),
  }));

  const datedRecords = withDates.filter((entry) => entry.dateValue !== undefined);
  const missingDateRecords = withDates.filter((entry) => entry.dateValue === undefined);

  if (datedRecords.length > 0) {
    const orderedDatedRecords = [...datedRecords].sort((left, right) => {
      if (left.dateValue === right.dateValue) {
        return left.index - right.index;
      }

      return (left.dateValue ?? 0) - (right.dateValue ?? 0);
    });

    return {
      orderedRecords: [...orderedDatedRecords.map((entry) => entry.record), ...missingDateRecords.map((entry) => entry.record)],
      strategy: "captureDate",
    };
  }

  const orderedByFilename = [...records].sort((left, right) => left.filename.localeCompare(right.filename));

  return {
    orderedRecords: orderedByFilename,
    strategy: "filename",
  };
}
