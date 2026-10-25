/** A reservation is made before each BYOB read, shared by all concurrent responses. */
export class BodyByteBudget {
  private available: number;
  private consumed = 0;
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;

  constructor(private readonly limit: number) {
    this.available = limit;
  }

  reserve(maximum: number): number {
    const size = Math.min(maximum, this.available);
    this.available -= size;
    return size;
  }

  settle(reserved: number, read: number): void {
    this.available += reserved - read;
    this.consumed += read;
    if (this.consumed >= this.limit) this.controller.abort();
  }
}
