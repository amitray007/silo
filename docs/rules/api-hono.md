# API rules (Hono adapter)

> The `@silo/api` package is a placeholder today. This file records the binding
> conventions now so the layer is built right; expand it when real routes land.

`@silo/api` is a **thin HTTP adapter over `@silo/core`** (see
[`architecture.md`](architecture.md)). It translates HTTP ↔ core calls and nothing
more.

## Do

- One route = parse input (Zod) → call one `core` function → shape the response.
- Validate every request body/query/param with a Zod schema at the edge; hand
  `core` already-typed values.
- Return honest errors — map core failures to appropriate status codes; never
  swallow an error into a 200.

## Don't

- No business logic in handlers. If a handler does more than translate, the logic
  belongs in `core`.
- No direct `@silo/db` import (ENFORCED — the gate rejects it).
- No shared mutable state between requests.
