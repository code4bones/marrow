export function normalizeTelegramTag(value: string): string {
  return value.replace(/^#/, "").normalize("NFC").toLowerCase();
}

export function telegramBotTags(value: unknown): string[] {
  let tags: unknown = value;
  if (typeof tags === "string") {
    try { tags = JSON.parse(tags); } catch { return []; }
  }
  return Array.isArray(tags) ? [...new Set(tags.filter((tag): tag is string => typeof tag === "string").map(normalizeTelegramTag))] : [];
}

export function matchesTelegramTags(configured: unknown, messageTags: string[]): boolean {
  const tags = new Set(telegramBotTags(configured));
  return messageTags.some((tag) => tags.has(normalizeTelegramTag(tag)));
}
