# Código fuente — Módulo 11

Código real del proyecto al cierre del Módulo 11: imagen multi-stage, entrypoint de contenedor con migraciones, compose del sistema completo (API + worker + Postgres + Redis), pipeline CI con audit + build + smoke, y Dependabot.

## `Dockerfile` — multi-stage: deps → build → runtime

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --omit=dev --legacy-peer-deps

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S jobtrack && adduser -S jobtrack -G jobtrack
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/docker-entry.mjs ./scripts/docker-entry.mjs
USER jobtrack
EXPOSE 3000
CMD ["node", "scripts/docker-entry.mjs"]
```

`npm prune --omit=dev` deja fuera `@nestjs/cli`, `@nestjs/mau`, `vitest`… Verificado: el runtime no tiene ni CLI ni devDependencies y corre como usuario no-root.

## `scripts/docker-entry.mjs` — API o worker, con migraciones idempotentes

```js
const APP = process.env.APP_PROCESS ?? 'api';
const MIGRATION_MAX_TRIES = 30;
const MIGRATION_RETRY_DELAY_MS = 2000;

function runMigrations() {
  const args = [
    'node_modules/typeorm/cli.js',
    'migration:run',
    '-d',
    'dist/database/data-source.js',
  ];
  let attempt = 0;
  let result;
  while (attempt < MIGRATION_MAX_TRIES) {
    result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.status === 0) return true;
    attempt += 1;
    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,
      0,
      MIGRATION_RETRY_DELAY_MS,
    );
  }
  return false;
}

const entryFor = {
  api: () => {
    if (!runMigrations()) process.exit(1);
    return 'dist/main.js';
  },
  worker: () => {
    if (!runMigrations()) process.exit(1);
    return 'dist/main-scraper.js';
  },
};

const entry = (entryFor[APP] ?? entryFor.api)();
const child = spawn(process.execPath, [entry], { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal)); // graceful shutdown del M10 también en contenedor
}
child.on('exit', (code, signal) => process.exit(signal ? 0 : (code ?? 1)));
```

## `docker-compose.yml` — deps por condición + healthchecks

```yaml
api:
  build: { context: . }
  environment:
    APP_PROCESS: api
    NODE_ENV: production
    DATABASE_URL: postgresql://jobtrack:jobtrack@postgres:5432/jobtrack?schema=public
    REDIS_URL: redis://redis:6379
    JWT_SECRET: ${JWT_SECRET:-dev-only-secret-please-change}
  healthcheck:
    test: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:3000/health || exit 1']
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }

worker:
  build: { context: . }
  environment:
    APP_PROCESS: worker   # → main-scraper.js (transporte Redis, sin HTTP)
    ...
  healthcheck:
    test: ['CMD-SHELL', 'ps -A | grep -q node || exit 1']
```

El worker no expone HTTP: su salud es "proceso vivo".

## `.github/workflows/ci.yml` — gate + audit + imagen + smoke

Jobs: `test` (pirámide M6), `audit` (`npm audit --omit=dev --audit-level=high`), `docker` (buildx + push GHCR solo en `main`), `smoke-containers` (compose + seed + `smoke.mjs`):

```yaml
docker:
  permissions: { contents: read, packages: write }
  steps:
    - uses: docker/setup-buildx-action@v3
    - uses: docker/login-action@v3
      with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
    - uses: docker/build-push-action@v6
      with:
        push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
        tags: |
          ghcr.io/${{ github.repository }}/jobtrack-api:latest
          ghcr.io/${{ github.repository }}/jobtrack-api:${{ github.sha }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
```

## `.github/dependabot.yml` — escaneo automático

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
    labels: [dependencias]
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: monthly }
```

## `scripts/smoke.mjs` — base configurable para CI

`const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3456';` — el smoke local apunta al `dist` y en CI apunta al contenedor (`SMOKE_BASE=http://localhost:3000`).

Anterior: [Código fuente (módulo 10)](/reference/code-module-10)
