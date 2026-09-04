/**
 * Computes an algorithm-qualified SHA-256 fingerprint for image bytes: sha256:<hex>
 * Uses Web Crypto in browser and Node environments.
 * Throws if crypto.subtle is unavailable or hashing fails.
 */
export async function computeContentHash(data: Uint8Array): Promise<string> {
  if (typeof crypto === "undefined" || !crypto?.subtle?.digest) {
    throw new Error(
      "Cryptographic hashing is unavailable in this environment. Cannot compute image fingerprint."
    );
  }

  const buffer = new Uint8Array(data).buffer;

  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return `sha256:${hex}`;
}

/**
 * Generates a collision-resistant import batch ID using crypto.randomUUID()
 * with a safe timestamp/random fallback.
 */
export function generateImportBatchId(fileName?: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return `batch-${crypto.randomUUID()}`;
    } catch {
      // Fall through to fallback
    }
  }

  const cleanName = fileName ? fileName.replace(/[^a-zA-Z0-9_-]/g, "_") : "import";
  return `batch-${cleanName}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
