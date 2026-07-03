import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Capture-status state machine (see plan HTD):
 * enriching (transient, on save) -> full | partial | bare (terminal).
 * `partial` and `bare` are retryable back to `enriching`. This increment only
 * stores/transitions the column; the enrichment worker that drives
 * transitions is a later increment.
 */
export const captureStatus = pgEnum('capture_status', ['enriching', 'full', 'partial', 'bare']);
