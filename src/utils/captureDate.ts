const EXIF_CAPTURE_DATE_PATTERN = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

export function parseCaptureDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  const exifMatch = trimmedValue.match(EXIF_CAPTURE_DATE_PATTERN);

  if (exifMatch) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = exifMatch;
    const year = Number(yearText);
    const month = Number(monthText) - 1;
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const parsed = new Date(year, month, day, hour, minute, second);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month ||
      parsed.getDate() !== day ||
      parsed.getHours() !== hour ||
      parsed.getMinutes() !== minute ||
      parsed.getSeconds() !== second
    ) {
      return null;
    }

    return parsed;
  }

  const parsedTimestamp = Date.parse(trimmedValue);
  return Number.isNaN(parsedTimestamp) ? null : new Date(parsedTimestamp);
}

export function normalizeCaptureDate(value: string | undefined): string | undefined {
  return parseCaptureDate(value)?.toISOString();
}