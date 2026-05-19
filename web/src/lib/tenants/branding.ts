type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

export function getReviewUrlFromBranding(brandingJson: unknown): string | null {
  const raw = toRecord(brandingJson);
  const candidate =
    raw.review_url ?? raw.reviewUrl ?? raw.google_review_url ?? raw.googleReviewUrl ?? null;

  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
