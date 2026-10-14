# One image for the whole app: Node serves /api/* and the built SPA (apps/web/dist).
# The server runs from one bundled file (apps/api/dist/server.mjs, built by apps/api/build.mjs): loading
# a thousand separate module files made a cold start several seconds longer.
# The same image runs the migrations from the sources, which Node 24 runs directly:
# `node apps/api/src/db/migrate.cli.ts` (so node_modules, src and drizzle stay in the image).

FROM node:24-slim AS base
RUN corepack enable pnpm
WORKDIR /app
# Manifests first, so dependency layers are cached until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# Builds the SPA and the server bundle with all dependencies.
FROM base AS web
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter web build && pnpm --filter api build

# Production dependencies of the API only.
FROM base AS api-deps
RUN pnpm install --frozen-lockfile --prod --filter api...

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/apps/web/dist
COPY --from=api-deps /app/node_modules node_modules
COPY --from=api-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=api-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/api/package.json apps/api/
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle
COPY --from=web /app/apps/web/dist apps/web/dist
COPY --from=web /app/apps/api/dist apps/api/dist
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "apps/api/dist/server.mjs"]
