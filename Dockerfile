# Módulo 11 — Dockerfile multi-stage: builds livianos para producción.
#
#   deps   → instala TODAS las dependencias (build necesita devDependencies).
#   build  → compila (nest build) y luego PODA devDependencies: la imagen de
#            runtime no trae @nestjs/cli, @nestjs/mau, vitest ni las demás
#            herramientas de desarrollo. Incluso las vulns de audit de ese
#            tooling NO viajan al artefacto desplegado.
#   runtime→ alpine + usuario no-root + solo dist/ + node_modules prod.

# ── Stage 1: dependencias ────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# ── Stage 2: build ────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev --legacy-peer-deps

# ── Stage 3: runtime (liviano) ───────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Usuario sin privilegios: el proceso no corre como root en el contenedor.
RUN addgroup -S jobtrack && adduser -S jobtrack -G jobtrack

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/docker-entry.mjs ./scripts/docker-entry.mjs

USER jobtrack
EXPOSE 3000

# Sin HEALTHCHECK de imagen: el API responde /health pero el PROCESSO worker
# es solo trasporte Redis. La salud se define por servicio en docker-compose.
CMD ["node", "scripts/docker-entry.mjs"]