export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Expected JSON string array.");
  }

  return parsed;
}

export function serializeJsonArray(value: string[] | undefined): string | null {
  if (!value || value.length === 0) {
    return null;
  }

  return JSON.stringify(value);
}
