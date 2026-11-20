export class TranslationCache {
  private readonly store = new Map<string, string>();

  constructor(private readonly maxEntries = 500) {}

  get(japaneseText: string): string | undefined {
    const key = japaneseText.trim();
    const val = this.store.get(key);
    if (val === undefined) {
      return undefined;
    }
    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, val);
    return val;
  }

  set(japaneseText: string, vietnameseTranslation: string): void {
    const key = japaneseText.trim();
    if (!key || !vietnameseTranslation.trim()) return;

    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, vietnameseTranslation.trim());
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
