-- Enable pgvector early so a future link_embeddings table (see plan U16 /
-- docs/plans/2026-07-04-001-feat-data-architecture-plan.md) bolts on with no
-- extension-enable migration needed later.
CREATE EXTENSION IF NOT EXISTS vector;
