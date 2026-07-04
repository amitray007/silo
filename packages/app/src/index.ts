/**
 * `@silo/app` has no library surface — it is a composition-root ENTRYPOINT
 * package (like `@silo/worker`'s `worker.ts`), not a library other packages
 * import. This file exists only so `exports["."]` resolves to something and
 * tooling (knip, the workspace graph) sees a valid package entry; it is
 * deliberately inert. The real turnkey process is `src/main.ts` (the `silo`
 * bin / `pnpm --filter @silo/app start`), which runs `main()` on import as an
 * entrypoint script does — never re-exported or imported from here.
 */
export {};
