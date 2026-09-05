# Módulo 11 — CI/CD, Docker y despliegue

> **Estado:** ✅ Completo · **Duración estimada:** 5–7 días
> **Rama de git sugerida:** `module-11-cicd`

## Conceptos clave

- **Dockerfile multi-stage**: cada stage sirve a un propósito y descarta lo que no necesita. El stage `deps` instala TODO (el build necesita devDependencies); el stage `build` compila y **podá** devDependencies; el stage `runtime` copia solo `dist/` + node_modules de producción + usuario no-root. Resultado: la imagen desplegada no tiene compilador, CLI ni herramientas de dev — e incluso las vulnerabilidades de _audit_ de ese tooling no viajan al artefacto.
- **Dos procesos, una imagen, dos comandos**: la app y el worker (Módulo 9) son el MISMO código con distinto bootstrap. En vez de dos imágenes, un `entrypoint` decide el proceso por `APP_PROCESS` (api|worker), y además **corre las migraciones** (idempotentes, serializadas con advisory lock de TypeORM) para que cualquiera de los dos pueda ser el primero contra una BD nueva sin condiciones de carrera.
- **Un comando para el revisor**: `docker compose up --build -d` levanta Postgres + Redis + API + worker con healthchecks y `depends_on` por condición. El pipeline completo queda a un solo comando para cualquier persona externa.
- **CI = gate + image + smoke**: no basta con "los tests pasan". El pipeline ejecuta la pirámide (Módulo 6), audita dependencias de **runtime** (fija fallo en high+), construye la imagen (y la publica en GHCR en `main`) y hace un smoke **contra el compose real** — el mismo artefacto que se va a desplegar, no solo `npm test`.
- **Staging ≠ producción**: el flujo documenta ambiente de staging antes de tocar producción, secrets por entorno y deploy no interactivo.

## Lo que se implementó

### 1. `Dockerfile` multi-stage

```dockerfile
FROM node:22-alpine AS deps      # npm ci (dev + prod, para compilar)
FROM node:22-alpine AS build     # nest build + npm prune --omit=dev
FROM node:22-alpine AS runtime   # usuario jobtrack (no-root), dist/ + prod node_modules
```

Verificado en vivo: la imagen runtime **no tiene** `@nestjs/cli`, `@nestjs/mau` ni `vitest` (podadas) y corre como usuario `jobtrack`, no como root.

### 2. `scripts/docker-entry.mjs` — entrypoint que decide el proceso

| `APP_PROCESS`   | Proceso                     | Migraciones                      |
| --------------- | --------------------------- | -------------------------------- |
| `api` (default) | `node dist/main.js`         | ✅ corre (con reintento acotado) |
| `worker`        | `node dist/main-scraper.js` | ✅ corre (idempotente)           |

El entry reenvía `SIGINT`/`SIGTERM` al proceso hijo para que el graceful shutdown del Módulo 10 funcione también dentro del contenedor.

### 3. `docker-compose.yml` — el sistema completo

```
postgres (16-alpine) + redis (7-alpine)   ← infra (Módulo 3 y 7)
api      (build ., APP_PROCESS=api)       ← HTTP /v1 + consumo de eventos Redis
worker   (build ., APP_PROCESS=worker)    ← microservicio de scraping (Módulo 9)
```

- `depends_on` con `condition: service_healthy` en vez de "arrancó".
- Secrets con defaults para dev local y referencias `${VAR:-default}` a un `.env` opcional.
- Healthchecks por servicio: API via `GET /health`; worker via proceso vivo (es solo transporte Redis).

```bash
docker compose up --build -d        # levanta los 4 servicios
docker compose ps                   # todo healthy
docker compose run --rm api node dist/database/seed.js   # datos de desarrollo (admin)
SMOKE_BASE=http://localhost:3000 npm run smoke          # smoke autenticado (22 checks)
```

### 4. Pipeline de GitHub Actions — `.github/workflows/ci.yml`

| Job                | Qué valida                                                                                                                         | Gate       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `test`             | lint → build → unit → integration → e2e (M6) contra Postgres/Redis de servicios                                                    | 🔴 bloquea |
| `audit`            | `npm audit --omit=dev --audit-level=high` (solo runtime; el tooling de dev queda documentado como excepción en el checklist OWASP) | 🔴 bloquea |
| `docker`           | build de la imagen con buildx + cache GHA; **push a GHCR** solo en `main` (`latest` + `sha`)                                       | 🔴 bloquea |
| `smoke-containers` | `docker compose up -d --build` + wait de health + seed + `smoke.mjs` contra el contenedor                                          | 🔴 bloquea |

### 5. Dependabot — `.github/dependabot.yml`

Escaneo npm (semanal) + GitHub Actions (mensual). Las PRs que abre pasan por el mismo gate de CI.

## Mejores prácticas aplicadas

- ✅ **Multi-stage honesto**: la imagen no trae lo que no corre (`npm prune --omit=dev` + no-root; los hallazgos de audit del dev tooling no llegan al artefacto).
- ✅ **Un entrypoint que corre migraciones antes de arrancar**: sin esto el primer deploy contra una BD vacía falla en la primera consulta. Reintento acotado por si Postgres aún se está iniciando.
- ✅ **Healthchecks por servicio y waits por condición**: compose ordena el arranque sin tiempos mágicos de sleeping.
- ✅ **El smoke valida el artefacto real**: el CI levanta el compose y testea el contenedor, no un `nest start` local.
- ✅ **Secrets nunca en el repo**: `.env` fuera de git, `${VAR:-default}` para dev, secrets del proveedor para staging/prod.
- ✅ **Deploy a publicar** (Railway/Render/Fly): el paso que queda atado al repo real en GitHub — mapear `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGINS` a los secrets del proveedor y apuntar el `Dockerfile` (multi-stage) como build; la imagen ya corre migraciones sola.

## Verificación del entregable

```bash
npm run build && npm run lint && npm test && npm run test:integration && npm run test:e2e   # gate M6 verde
docker compose up --build -d                # 4/4 healthy
docker compose run --rm api node dist/database/seed.js    # seed ok
SMOKE_BASE=http://localhost:3000 npm run smoke            # SMOKE OK (22 assertions)
# GET /v1/scraping/worker → { status: 'up' }  ← worker responde por Redis transport
npm run docs:build                          # documentación builda
```

Anterior: [Módulo 10](/guide/module-10) · Siguiente: [Módulo 12](/guide/module-12)
