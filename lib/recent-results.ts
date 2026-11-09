/**
 * Remembers results for a short time, so looking up the same URL again
 * doesn't fetch the site again. Kept in server memory: it's lost when the
 * server restarts.
 */
export class RecentResults<T> {
  private readonly entries = new Map<string, { value: T; savedAt: number }>();
  private readonly maxAgeMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(maxAgeMs: number, maxEntries: number, now: () => number = Date.now) {
    this.maxAgeMs = maxAgeMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.savedAt > this.maxAgeMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // A Map keeps insertion order, so the first key is always the oldest.
    this.entries.delete(key);
    this.entries.set(key, { value, savedAt: this.now() });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}
