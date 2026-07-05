/**
 * Import Sidecar JSON v1
 * 
 * Optional JSON file that can be included in ZIP imports to provide:
 * - Visit-level metadata (location, weather, notes)
 * - Per-image metadata overrides and enhancements
 * - Global import settings
 * 
 * The sidecar is completely optional. If present, it enriches the automatic
 * extraction but does not prevent import if parsing fails.
 * 
 * Convention: Place as "blomzip.json" or "sidecar.json" in ZIP root.
 */

export interface ImportSidecarV1 {
  version: "1.0";
  
  // Visit-level metadata
  visit?: VisitMetadata;
  
  // Per-image metadata and overrides
  images?: ImageSidecarMetadata[];
  
  // Import settings
  settings?: ImportSettings;
}

export interface VisitMetadata {
  // Preferred visit date if not inferrable from images (ISO 8601)
  date?: string;
  
  // Visit location
  location?: LocationData;
  
  // Weather conditions during visit
  weather?: WeatherData;
  
  // General notes about the visit
  notes?: string;
  
  // Name or identifier for this visit
  name?: string;
}

export interface LocationData {
  // WGS84 coordinates
  latitude?: number;
  longitude?: number;
  
  // Human-readable location name
  name?: string;
  
  // Optional elevation in meters
  elevation?: number;
}

export interface WeatherData {
  // Temperature in Celsius
  temperature?: number;
  
  // Weather conditions (e.g., "sunny", "cloudy", "rainy")
  conditions?: string;
  
  // Humidity percentage (0-100)
  humidity?: number;
  
  // Wind speed in m/s
  windSpeed?: number;
}

export interface ImageSidecarMetadata {
  // Filename (must match a file in the ZIP exactly)
  filename: string;
  
  // Override capture date (ISO 8601 timestamp) if extraction failed
  captureDate?: string;
  
  // Image dimensions if needed
  dimensions?: {
    width: number;
    height: number;
  };
  
  // GPS location for this specific image
  location?: LocationData;
  
  // Image-specific notes or description
  notes?: string;
  
  // Tags or categories for this image
  tags?: string[];
  
  // Custom metadata key-value pairs
  custom?: Record<string, string | number | boolean>;
}

export interface ImportSettings {
  // Timezone for date/time interpretation
  timezone?: string;
  
  // Skip validation errors and continue with best effort
  lenient?: boolean;
}

// Type guard for checking if an object is a valid ImportSidecarV1
export function isImportSidecarV1(obj: unknown): obj is ImportSidecarV1 {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  
  const sidecar = obj as Record<string, unknown>;
  
  if (sidecar.version !== "1.0") {
    return false;
  }
  
  return true;
}

// Validation errors for sidecar JSON
export interface SidecarValidationError {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface SidecarValidationResult {
  valid: boolean;
  errors: SidecarValidationError[];
  warnings: SidecarValidationError[];
}
