import { type ImportSidecarV1, type LocationData, type SidecarValidationResult } from "../models/importSidecar";

/**
 * Validates an Import Sidecar JSON object against the v1 schema.
 * 
 * Returns both errors (blocking) and warnings (informational).
 * 
 * @param sidecar The sidecar object to validate
 * @param availableImageFilenames List of image filenames in the ZIP (for reference checking)
 * @returns Validation result with errors and warnings
 */
export function validateSidecar(
  sidecar: ImportSidecarV1,
  availableImageFilenames: string[]
): SidecarValidationResult {
  const errors: Array<{ path: string; message: string; severity: "error" | "warning" }> = [];

  // Validate version
  if (sidecar.version !== "1.0") {
    errors.push({
      path: "version",
      message: `Unsupported version "${sidecar.version}", expected "1.0"`,
      severity: "error",
    });
  }

  // Validate visit metadata
  if (sidecar.visit) {
    validateVisitMetadata(sidecar.visit, errors);
  }

  // Validate per-image metadata
  if (sidecar.images && Array.isArray(sidecar.images)) {
    const availableSet = new Set(availableImageFilenames);

    sidecar.images.forEach((img, index) => {
      validateImageMetadata(img, index, availableSet, errors);
    });
  }

  // Validate settings
  if (sidecar.settings) {
    validateSettings(sidecar.settings, errors);
  }

  return {
    valid: errors.filter((e) => e.severity === "error").length === 0,
    errors: errors.filter((e) => e.severity === "error"),
    warnings: errors.filter((e) => e.severity === "warning"),
  };
}

function validateVisitMetadata(visit: unknown, errors: Array<{ path: string; message: string; severity: "error" | "warning" }>) {
  const visitRecord = visit as Record<string, unknown>;

  if (visitRecord.date !== undefined) {
    if (typeof visitRecord.date !== "string") {
      errors.push({
        path: "visit.date",
        message: "Expected string (ISO 8601 date)",
        severity: "error",
      });
    } else if (!isValidISO8601(visitRecord.date)) {
      errors.push({
        path: "visit.date",
        message: `Invalid ISO 8601 date format: "${visitRecord.date}"`,
        severity: "warning",
      });
    }
  }

  if (visitRecord.location !== undefined) {
    validateLocation(visitRecord.location, "visit.location", errors);
  }

  if (visitRecord.weather !== undefined) {
    validateWeather(visitRecord.weather, "visit.weather", errors);
  }

  if (visitRecord.notes !== undefined && typeof visitRecord.notes !== "string") {
    errors.push({
      path: "visit.notes",
      message: "Expected string",
      severity: "error",
    });
  }

  if (visitRecord.name !== undefined && typeof visitRecord.name !== "string") {
    errors.push({
      path: "visit.name",
      message: "Expected string",
      severity: "error",
    });
  }
}

function validateImageMetadata(
  img: unknown,
  index: number,
  availableFilenames: Set<string>,
  errors: Array<{ path: string; message: string; severity: "error" | "warning" }>
) {
  const imgRecord = img as Record<string, unknown>;
  const basePath = `images[${index}]`;

  // Validate filename
  if (typeof imgRecord.filename !== "string") {
    errors.push({
      path: `${basePath}.filename`,
      message: "Expected string",
      severity: "error",
    });
    return; // Can't validate further without filename
  }

  if (!imgRecord.filename) {
    errors.push({
      path: `${basePath}.filename`,
      message: "Filename cannot be empty",
      severity: "error",
    });
    return;
  }

  if (!availableFilenames.has(imgRecord.filename)) {
    errors.push({
      path: `${basePath}.filename`,
      message: `Image file not found in ZIP: "${imgRecord.filename}"`,
      severity: "warning",
    });
  }

  // Validate captureDate
  if (imgRecord.captureDate !== undefined) {
    if (typeof imgRecord.captureDate !== "string") {
      errors.push({
        path: `${basePath}.captureDate`,
        message: "Expected string (ISO 8601 timestamp)",
        severity: "error",
      });
    } else if (!isValidISO8601(imgRecord.captureDate)) {
      errors.push({
        path: `${basePath}.captureDate`,
        message: `Invalid ISO 8601 timestamp format: "${imgRecord.captureDate}"`,
        severity: "warning",
      });
    }
  }

  // Validate dimensions
  if (imgRecord.dimensions !== undefined) {
    validateDimensions(imgRecord.dimensions, `${basePath}.dimensions`, errors);
  }

  // Validate location
  if (imgRecord.location !== undefined) {
    validateLocation(imgRecord.location, `${basePath}.location`, errors);
  }

  // Validate notes
  if (imgRecord.notes !== undefined && typeof imgRecord.notes !== "string") {
    errors.push({
      path: `${basePath}.notes`,
      message: "Expected string",
      severity: "error",
    });
  }

  // Validate tags
  if (imgRecord.tags !== undefined) {
    if (!Array.isArray(imgRecord.tags)) {
      errors.push({
        path: `${basePath}.tags`,
        message: "Expected array of strings",
        severity: "error",
      });
    } else {
      imgRecord.tags.forEach((tag, tagIndex) => {
        if (typeof tag !== "string") {
          errors.push({
            path: `${basePath}.tags[${tagIndex}]`,
            message: "Expected string",
            severity: "error",
          });
        }
      });
    }
  }

  // Validate custom metadata
  if (imgRecord.custom !== undefined) {
    if (typeof imgRecord.custom !== "object" || imgRecord.custom === null || Array.isArray(imgRecord.custom)) {
      errors.push({
        path: `${basePath}.custom`,
        message: "Expected object with string/number/boolean values",
        severity: "error",
      });
    } else {
      Object.entries(imgRecord.custom as Record<string, unknown>).forEach(([key, value]) => {
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
          errors.push({
            path: `${basePath}.custom.${key}`,
            message: "Expected string, number, or boolean",
            severity: "error",
          });
        }
      });
    }
  }
}

function validateLocation(
  location: unknown,
  path: string,
  errors: Array<{ path: string; message: string; severity: "error" | "warning" }>
) {
  if (typeof location !== "object" || location === null) {
    errors.push({
      path,
      message: "Expected object",
      severity: "error",
    });
    return;
  }

  const loc = location as LocationData;

  if (loc.latitude !== undefined) {
    if (typeof loc.latitude !== "number") {
      errors.push({
        path: `${path}.latitude`,
        message: "Expected number",
        severity: "error",
      });
    } else if (loc.latitude < -90 || loc.latitude > 90) {
      errors.push({
        path: `${path}.latitude`,
        message: `Invalid latitude: ${loc.latitude} (expected -90 to 90)`,
        severity: "error",
      });
    }
  }

  if (loc.longitude !== undefined) {
    if (typeof loc.longitude !== "number") {
      errors.push({
        path: `${path}.longitude`,
        message: "Expected number",
        severity: "error",
      });
    } else if (loc.longitude < -180 || loc.longitude > 180) {
      errors.push({
        path: `${path}.longitude`,
        message: `Invalid longitude: ${loc.longitude} (expected -180 to 180)`,
        severity: "error",
      });
    }
  }

  if (loc.name !== undefined && typeof loc.name !== "string") {
    errors.push({
      path: `${path}.name`,
      message: "Expected string",
      severity: "error",
    });
  }

  if (loc.elevation !== undefined) {
    if (typeof loc.elevation !== "number") {
      errors.push({
        path: `${path}.elevation`,
        message: "Expected number (meters)",
        severity: "error",
      });
    }
  }
}

function validateWeather(
  weather: unknown,
  path: string,
  errors: Array<{ path: string; message: string; severity: "error" | "warning" }>
) {
  if (typeof weather !== "object" || weather === null) {
    errors.push({
      path,
      message: "Expected object",
      severity: "error",
    });
    return;
  }

  const w = weather as Record<string, unknown>;

  if (w.temperature !== undefined) {
    if (typeof w.temperature !== "number") {
      errors.push({
        path: `${path}.temperature`,
        message: "Expected number (Celsius)",
        severity: "error",
      });
    }
  }

  if (w.conditions !== undefined && typeof w.conditions !== "string") {
    errors.push({
      path: `${path}.conditions`,
      message: "Expected string",
      severity: "error",
    });
  }

  if (w.humidity !== undefined) {
    if (typeof w.humidity !== "number") {
      errors.push({
        path: `${path}.humidity`,
        message: "Expected number (0-100)",
        severity: "error",
      });
    } else if (w.humidity < 0 || w.humidity > 100) {
      errors.push({
        path: `${path}.humidity`,
        message: `Invalid humidity: ${w.humidity} (expected 0-100)`,
        severity: "error",
      });
    }
  }

  if (w.windSpeed !== undefined) {
    if (typeof w.windSpeed !== "number") {
      errors.push({
        path: `${path}.windSpeed`,
        message: "Expected number (m/s)",
        severity: "error",
      });
    } else if (w.windSpeed < 0) {
      errors.push({
        path: `${path}.windSpeed`,
        message: `Invalid wind speed: ${w.windSpeed} (expected >= 0)`,
        severity: "error",
      });
    }
  }
}

function validateDimensions(
  dimensions: unknown,
  path: string,
  errors: Array<{ path: string; message: string; severity: "error" | "warning" }>
) {
  if (typeof dimensions !== "object" || dimensions === null) {
    errors.push({
      path,
      message: "Expected object with width and height",
      severity: "error",
    });
    return;
  }

  const dims = dimensions as Record<string, unknown>;

  if (typeof dims.width !== "number" || dims.width <= 0) {
    errors.push({
      path: `${path}.width`,
      message: "Expected positive number",
      severity: "error",
    });
  }

  if (typeof dims.height !== "number" || dims.height <= 0) {
    errors.push({
      path: `${path}.height`,
      message: "Expected positive number",
      severity: "error",
    });
  }
}

function validateSettings(
  settings: unknown,
  errors: Array<{ path: string; message: string; severity: "error" | "warning" }>
) {
  if (typeof settings !== "object" || settings === null) {
    errors.push({
      path: "settings",
      message: "Expected object",
      severity: "error",
    });
    return;
  }

  const s = settings as Record<string, unknown>;

  if (s.timezone !== undefined && typeof s.timezone !== "string") {
    errors.push({
      path: "settings.timezone",
      message: "Expected string (IANA timezone ID)",
      severity: "error",
    });
  }

  if (s.lenient !== undefined && typeof s.lenient !== "boolean") {
    errors.push({
      path: "settings.lenient",
      message: "Expected boolean",
      severity: "error",
    });
  }
}

/**
 * Simple ISO 8601 date/datetime validation using regex.
 * Accepts both date-only (YYYY-MM-DD) and datetime (YYYY-MM-DDTHH:mm:ssZ or with offset).
 */
function isValidISO8601(dateString: string): boolean {
  // Strict ISO 8601 pattern - only accepts date or datetime with T separator and timezone
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})?)?$/;

  if (!iso8601Pattern.test(dateString)) {
    return false;
  }

  // Try to parse as Date to catch invalid dates like 2023-02-30
  try {
    const date = new Date(dateString);
    
    // Check if the date parsed successfully and doesn't have NaN
    if (isNaN(date.getTime())) {
      return false;
    }
    
    // Additional validation: verify that month and day are reasonable
    // by checking if the date string components match what JavaScript parsed
    const parts = dateString.split('T')[0].split('-');
    const [, month, day] = parts.map(p => parseInt(p, 10));
    
    // Validate month and day ranges
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}
