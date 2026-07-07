/**
 * Runs `task` over every item in `items` with at most `limit` in flight at
 * once (the plan: "batch with bounded concurrency, e.g. 5-10 in flight, NOT
 * 1381 at once"). A simple worker-pool: `limit` workers each pull the next
 * item off a shared index until the queue is exhausted, rather than
 * chunking into fixed-size batches (a worker-pool keeps every slot busy —
 * a batch approach would let the whole batch wait on its slowest member
 * before starting the next batch). `onResult` fires after each item settles
 * (success or failure) so a caller can show live progress ("ingesting
 * 43/1381…") without waiting for the whole run.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onResult?: (
    result: { item: T; index: number } & ({ ok: true; value: R } | { ok: false; error: unknown }),
  ) => void,
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;

      try {
        const value = await task(item, index);
        onResult?.({ item, index, ok: true, value });
      } catch (error) {
        onResult?.({ item, index, ok: false, error });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
