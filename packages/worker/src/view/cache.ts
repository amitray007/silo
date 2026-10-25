type Entry<T> = { value: T; bytes: number; expires: number };

/** LRU of encoded page bytes, not an entry-count approximation. */
export class PageCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private used = 0;

  constructor(
    private readonly budget = 32 * 1024 * 1024,
    private readonly ttlMs = 10 * 60 * 1_000,
    private readonly now = Date.now,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.remove(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    this.used += entry.bytes;
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    this.remove(key);
    const size = bytes + Buffer.byteLength(key);
    if (size > this.budget) return;
    for (const [key, entry] of this.entries) {
      if (entry.expires <= this.now()) this.remove(key);
    }
    while (this.used + size > this.budget) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.remove(first);
    }
    this.entries.set(key, { value, bytes: size, expires: this.now() + this.ttlMs });
    this.used += size;
  }

  private remove(key: string): void {
    const previous = this.entries.get(key);
    if (previous) this.used -= previous.bytes;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.used = 0;
  }
}
