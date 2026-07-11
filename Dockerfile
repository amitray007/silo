# syntax=docker/dockerfile:1

# silo — one image, two roles (the deployable-silo slice,
# docs/superpowers/specs/2026-07-11-deployable-silo-design.md).
#
# The SAME image runs as either the `api` container (web UI + REST + the
# enrichment worker, in-process) or the `mcp` container (the HTTP MCP
# listener). The role is chosen by the COMMAND, not by building two images:
#   api:  tsx packages/api/src/main.ts      (SILO_WEB_DIST -> the built SPA)
#   mcp:  tsx packages/app/src/main.ts       (SILO_MCP_HTTP_PORT set)
# See docker-compose.prod.yml for how each service overrides the command.
#
# Backend runs via tsx at runtime (the repo is noEmit — only @silo/web is
# precompiled). So the runtime image ships the TS source + node_modules + tsx,
# and the ONE precompiled artifact is the web SPA (built in the `build` stage).
# Node >=24 and pnpm@10.33.2 match the repo's engines/packageManager pins.

# ---- base: node + pnpm via corepack -----------------------------------------
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

# ---- deps: install the full workspace from a frozen lockfile ----------------
# Copy only what `pnpm install` needs first, so the (slow) install layer is
# cached and only re-runs when a manifest or the lockfile changes — not on
# every source edit. `--frozen-lockfile` makes the build fail loudly if the
# lockfile is stale rather than silently resolving a different tree.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Workspace package manifests (globbed by path so the install graph is complete
# before any source is copied). Keep in sync with pnpm-workspace.yaml's globs.
COPY packages/ ./packages/
COPY extensions/ ./extensions/
# `--ignore-scripts`: the root `prepare` script is `lefthook install` (git
# hooks — a DEV-machine concern), which needs `git` + a `.git` dir, neither of
# which exists in this image (git isn't installed; `.git` is .dockerignore'd).
# Skipping lifecycle scripts drops that (and `sharp`'s native-binary postinstall
# — sharp is a devDep used ONLY by a manual icon-gen script, never by the vite
# build or the runtime), so the container install has no git dependency.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# ---- build: compile the web SPA ---------------------------------------------
# Only the web frontend has a real build (vite -> packages/web/dist). The
# backend is not compiled (tsx-at-runtime), so there's nothing else to build.
FROM deps AS build
RUN pnpm --filter @silo/web build

# ---- runtime: source + deps + built SPA -------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# The whole installed workspace (node_modules + source), then overlay the built
# SPA from the build stage. `SILO_WEB_DIST` points the API's static server at it
# (see app.ts); the mcp role ignores it.
COPY --from=build /app /app
ENV SILO_WEB_DIST=/app/packages/web/dist
# The API binds off-loopback inside the container (Traefik/compose reaches it by
# service name); the api role sets HOST=0.0.0.0 via compose. Default command is
# the api role — the @silo/app COMPOSITION-ROOT entrypoint that serves web + API
# + the in-process worker (api-main.ts). NOT `@silo/api start`: an adapter can't
# import the worker (dependency-cruiser boundary), so the composition root is
# what wires web+API+worker into one process. The mcp service overrides this
# command in compose.
#
# `pnpm --filter @silo/app run start:api` (NOT `pnpm exec tsx …` from the repo
# root): with pnpm's isolated node_modules, `tsx`'s bin is linked into
# `packages/app/node_modules/.bin`, not the ROOT `.bin` — so `pnpm exec tsx`
# from `/app` fails with "Command tsx not found". Running the package's own
# `start:api` script executes in that package's context where tsx resolves.
CMD ["pnpm", "--filter", "@silo/app", "run", "start:api"]
