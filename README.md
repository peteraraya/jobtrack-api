<div align="center">

# 🚀 JobTrack API

### 🎯 Backend NestJS para una plataforma de gestión de búsqueda de empleo

[![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Zod](https://img.shields.io/badge/Zod-validation-3E67B1?style=for-the-badge&logo=zod&logoColor=white)](https://zod.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![TypeORM](https://img.shields.io/badge/TypeORM-1.x-262627?style=for-the-badge&logo=typeorm&logoColor=white)](https://typeorm.io)
[![Vitest](https://img.shields.io/badge/Vitest-6C31E3?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
[![BullMQ](https://img.shields.io/badge/BullMQ-6-F07436?style=for-the-badge&logo=bullmq&logoColor=white)](https://docs.bullmq.io)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io)
[![NestJS Microservices](https://img.shields.io/badge/NestJS-Microservices-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://docs.nestjs.com/microservices/redis)
[![Docker](https://img.shields.io/badge/Docker-compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-CI%2FCD-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/features/actions)

**✨ Proyecto de portafolio guiado por una hoja de ruta de 13 módulos: de NestJS a production-ready. Agrega ofertas laborales, gestiona postulaciones con estados y recibe recomendaciones según tu perfil profesional.**

</div>

---

## 🎯 Objetivo

> API REST de producción que resuelve un **problema real**: organizar la búsqueda de empleo. Cada módulo agrega una capa de complejidad sobre el mismo dominio, cubriendo todos los temas que busca un entrevistador técnico senior de NestJS.

## 🧱 Arquitectura

```
                     ┌─────────────────────────── PROCESO API ───────────────────────────┐
                     │                                                                  │
  Client HTTP ─────▶│  /v1/auth /companies /job-offers /applications /notifications      │
  (REST /v1)        │    Guard JWT/RBAC → DTO/Zod → Service → Repository → Postgres      │
  WebSocket ───────▶│  Gateway /notifications (auth WS en handshake, rooms user:<id>)    │
                     │                                                                  │
                     │  Coales: notif cola BullMQ ─▶ NotifyProcessor ─▶ NotifService     │
                     │  @EventPattern ('job-offer.created') ◀──┐                         │
                     └─────────────────────────────────────────┼─────────────────────────┘
                                                               │  Redis transport
                     ┌─────────────────────────────────────────┼─────────────────────────┐
                     │                                         ▼                         │
                     │  PROCESO WORKER (main-scraper)   cron ─▶ cola ingest (BullMQ)      │
                     │  fetch con breaker ─▶ upsert idempotente ─▶ emit evento            │
                     └───────────────────────────────────────────────────────────────────┘

  Postgres 16 (migraciones versionadas, synchronize OFF) · Redis 7 (colas + transport + throttle)
```

**Flujo de un scraping:** cron en el **worker** encola `ingest` → extrae con circuit breaker → upsert idempotente por `sourceUrl` (`ON CONFLICT DO UPDATE`) → **publica** `job-offer.created` por Redis transport → el **API** lo consume (`@EventPattern`), encola su cola `notify` → match por stack → push **WebSocket** al usuario. Dos procesos, dos decisiones semánticas: _comando_ (cola `ingest`, reintentos) vs _evento_ (dominio publicado, nadie responde).

**Decisiones técnicas clave y sus trade-offs:**

| Decisión                                                                                                 | Por qué                                                                           | Trade-off                                                                 |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Micromonolito local** (M9): worker como segundo proceso                                                | desacople real del pipeline y worker escalable a otra máquina sin tocar contratos | complejidad operacional (2 procesos), latencia de red, orquestación local |
| **Dos canales** para el scraping: cola `ingest` (comando) + Redis transport (evento `job-offer.created`) | cada uno sirve a su semanticidad: reintentos/backoff vs. desacople dominio        | más infraestructura que un simple cron in-process                         |
| **Sincrónico `ON CONFLICT DO UPDATE`** + breaker por fuente                                              | scraping idempotente y seguro ante fallos                                         | las fuentes no se re-procesan "desde la cuna" si cambia el criterio       |
| **`synchronize: false` + migraciones versionadas**                                                       | el esquema evoluciona con control y se despliega ordenadamente                    | necesitás un paso de migración (el Dockerfile lo corre con retry)         |
| **Refresh rotation con hash** en DB                                                                      | el refresh robado pierde valor: cada uso invalida el anterior                     | la rotación agrega una escritura por login                                |
| **REST `/v1` + WS sin prefijo** (M10)                                                                    | contrato estable, evolucionable sin romper consumidores                           | toda breaking change futura exige v2                                      |
| **Imagen sin devDependencies** (M11)                                                                     | menos superficie de ataque (las vulns de audit del tooling no viajan)             | el build es más lento que un `COPY node_modules` de una sola stage        |

Ver la historia completa en [docs/guide/war-stories.md](docs/guide/war-stories.md) y el guion de demo en [docs/guide/walkthrough.md](docs/guide/walkthrough.md).

**Cobertura del roadmap:**

1. 🏗️ **Fundamentos** — setup, DI, módulos, providers.
2. 🔒 **Validación y errores** — DTOs, pipes, filters.
3. 🗄️ **Persistencia** — PostgreSQL, relaciones, migraciones, transacciones.
4. 🔐 **Autenticación** — JWT + refresh rotation, RBAC, ownership.
5. 📊 **Observabilidad** — interceptors, middleware, requestId.
6. 🧪 **Testing** — pirámide completa (unit + integration + e2e).
7. ⚙️ **Scheduling y colas** — cron + BullMQ, scraping idempotente.
8. ⚡ **WebSockets** — notificaciones en tiempo real (Socket.IO + rooms + auth en el handshake).
9. 🧩 **Microservicios** — worker de scraping extraído como proceso independiente (Redis transport + cola BullMQ), evento `job-offer.created`, request-response `scraping.ping`/`scraping.ingest` y **trade-off documentado**.
10. 🛡️ **Seguridad** — checklist OWASP, graceful shutdown, API versionada (`/v1`).
11. 🚢 **CI/CD y deploy** — Docker multi-stage, compose completo, GitHub Actions (gate + audit + imagen GHCR + smoke), Dependabot.
12. 📈 **Cierre** — portafolio, [war stories](docs/guide/war-stories.md), [walkthrough](docs/guide/walkthrough.md).

---

## ⚡ Inicio Rápido

```bash
# 1. Clonar el repositorio
git clone https://github.com/peteraraya/jobtrack-api.git

# 2. Instalar dependencias
npm install --legacy-peer-deps

# 3. Copiar y configurar variables de entorno
cp .env.example .env

# 4. Levantar PostgreSQL (5433) + Redis (6379) en Docker y aplicar migraciones
npm run db:up
npm run db:migration:run

# 5. Iniciar el servidor de desarrollo (API)
npm run start:dev

# 5b. (Módulo 9) En otra terminal, el microservicio worker de scraping
npm run start:worker

# 6. Verificar que responde (incluye ping a la base)
curl http://localhost:3000/health
# → {"status":"ok","info":{"database":{"status":"up"},...}}
```

> ⚡ **Un comando (Módulo 11):** para levantar el sistema completo — API + worker de scraping + Postgres + Redis — no hace falta ni `npm install`:

```bash
docker compose up --build -d        # 4 servicios: postgres, redis, api, worker (todo healthy)
docker compose run --rm api node dist/database/seed.js   # datos de desarrollo (admin seed)
SMOKE_BASE=http://localhost:3000 npm run smoke           # smoke autenticado (22 checks)

# Los procesos arrancan y hacen las migraciones solos (entrypoint con retry);
# los secrets de producción se setean por variables de entorno.
```

> 💡 **Tip:** la app valida las variables de entorno al arrancar con **Zod** — si falta `DATABASE_URL`, `JWT_SECRET` u otra requerida, el proceso no inicia. Configurá tu `.env` antes de levantar.

---

## 📚 Guía Interactiva (VitePress)

La hoja de ruta completa vive en una **documentación web navegable**: 13 páginas de módulos con conceptos, ejercicios, mejores prácticas, entregables y **código real embebido del proyecto**.

```bash
npm run docs:dev        # 📖 Documentación en modo desarrollo → http://localhost:5173
npm run docs:build      # 🏗️ Build estático para producción (GitHub Pages)
```

| Sección             | Contenido                                                     |
| ------------------- | ------------------------------------------------------------- |
| 🏠 Landing          | Hero del proyecto + features                                  |
| 🗺️ Guía             | Intro, cómo usar el roadmap, estructura del proyecto          |
| 📦 Módulos 0–12     | Conceptos, ejercicios, retos de entrevista, mejores prácticas |
| 🧬 Referencia       | Entidades de dominio + código fuente embebido                 |
| 📜 Roadmap original | Documento base completo                                       |

> 🚀 **Deploy automático** a GitHub Pages mediante `.github/workflows/docs.yml` (ver sección _Despliegue_).

---

## 🗂️ Estructura del Proyecto

```
📦 jobtrack-api
 ┣ 📂 src/
 ┃ ┣ 📂 config/               🔹 Validación de env vars (Zod) + opciones de DB
 ┃ ┃ ┣ 📄 configuration.ts
 ┃ ┃ ├ 📄 database.ts          🔹 getDatabaseOptions() + ALL_ENTITIES
 ┃ ┃ ┗ 📄 redis.client.ts      🔹 M9: parseRedisUrl + opciones del transporte Redis
 ┃ ┣ 📄 configure-app.ts      🔹 Pipeline compartida runtime + e2e (pipes/filtro/body limit)
 ┃ ┣ 📄 main.ts               🔹 Bootstrap del API (HTTP + consume eventos del worker)
 ┃ ┣ 📄 main-scraper.ts       🔹 Bootstrap del microservicio worker (M9, npm run start:worker)
 ┃ ┣ 📂 database/             🔹 Migraciones, seed y demos de entrevista
 ┃ ┃ ┣ 📄 data-source.ts       🔹 DataSource del CLI de TypeORM
 ┃ ┃ ┣ 📂 migrations/          🔹 SchemaInit (migración inicial versionada)
 ┃ ┃ ┣ 📄 seed-data.ts / seed.ts 🔹 Seeds de desarrollo
 ┃ ┃ ┗ 📄 n1-comparison.ts     🔹 Demo N+1 (npm run db:n1)
 ┃ ┣ 📂 common/
 ┃ ┃ ┣ 📂 observability/      🔹 AsyncLocalStorage, x-request-id, log JSON, { data, meta } (M5)
 ┃ ┃ ┣ 📂 guards/             🔹 JwtAuthGuard (401) + RolesGuard (403)
 ┃ ┃ ┣ 📂 decorators/         🔹 @Public, @Roles, @CurrentUser
 ┃ ┃ ┣ 📂 pipes/              🔹 TrimPipe + ZodValidationPipe globales
 ┃ ┃ ┣ 📂 filters/            🔹 AllExceptionsFilter (@Catch() global)
 ┃ ┃ ┗ 📂 utils/              🔹 is-uuid (404) + is-unique-violation (23505→409)
 ┃ ┣ 📂 modules/
 ┃ ┃ ┣ 📂 auth/               🔹 register/login/refresh/logout/me (JWT + refresh rotation)
 ┃ ┃ ┃   ├ 📄 auth.controller.ts         (throttling estricto en register/login)
 ┃ ┃ ┃   ├ 📄 auth.service.ts            (issueTokens con jti + rotation)
 ┃ ┃ ┃   ├ 📄 crypto.ts                  (bcryptjs + SHA-256 pre-bcrypt + timing equalizer)
 ┃ ┃ ┃   ├ 📄 auth-throttle.const.ts
 ┃ ┃ ┃   ├ 📂 dto/ · 📂 exceptions/ · 📂 interfaces/
 ┃ ┃ ┃   └ 📂 strategies/jwt.strategy.ts (re-valida user por request)
 ┃ ┃ ┣ 📂 users/              🔹 Puerto de usuarios (findByEmail, setRefreshTokenHash)
 ┃ ┃ ┣ 📂 companies/          🔹 CRUD de empresas (GET público, writes admin)
 ┃ ┃ ┃   ├ 📄 companies.module.ts
 ┃ ┃ ┃   ├ 📄 companies.controller.ts
 ┃ ┃ ┃   ├ 📄 companies.service.ts
 ┃ ┃ ┃   ├ 📄 companies.repository.ts       (interfaz async / puerto)
 ┃ ┃ ┃   ├ 📄 typeorm-companies.repository.ts
 ┃ ┃ ┃   ├ 📂 dto/
 ┃ ┃ ┃   ├ 📂 exceptions/
 ┃ ┃ ┃   └ 📂 entities/
 ┃ ┃ ┣ 📂 job-offers/         🔹 CRUD + paginación por cursor (keyset; writes admin)
 ┃ ┃ ┃   ├ 📄 job-offers.module.ts          (token custom JOB_SOURCE_CONFIG)
 ┃ ┃ ┃   ├ 📄 job-offers.controller.ts
 ┃ ┃ ┃   ├ 📄 job-offers.service.ts         (findPage: limit + nextCursor)
 ┃ ┃ ┃   ├ 📄 job-offers.repository.ts       (interfaz async / puerto)
 ┃ ┃ ┃   ├ 📄 typeorm-job-offers.repository.ts
 ┃ ┃ ┃   ├ 📄 job-offers.pagination.ts      (cursor base64url)
 ┃ ┃ ┃   ├ 📂 dto/
 ┃ ┃ ┃   ├ 📂 exceptions/
 ┃ ┃ ┃   └ 📂 entities/
 ┃ ┃ ┣ 📂 applications/       🔹 POST (userId del token) + ownership en PATCH /:id
 ┃ ┃ ┃   ├ 📄 applications.repository.ts     (interfaz async / puerto)
 ┃ ┃ ┃   ├ 📄 typeorm-applications.repository.ts  (createWithSlotDecrement)
 ┃ ┃ ┃   └ 📂 exceptions/                 (SlotsExhaustedException, 409)
 ┃ ┃ ┣ 📂 profiles/             🔹 Perfil OneToOne (match de stack en M7)
 ┃ ┃ ┣ 📂 notifications/       🔹 M7+M8: match de stack, persistencia y canal realtime + REST
 ┃ ┃ ┃   ├ 📄 notifications.module.ts      (UsersModule + JwtModule + EventEmitterModule)
 ┃ ┃ ┃   ├ 📄 notifications.service.ts     (emite `notification.created` por cada alta)
 ┃ ┃ ┃   ├ 📄 notifications.events.ts      (NOTIFICATION_CREATED_EVENT, shape del payload)
 ┃ ┃ ┃   ├ 📄 notifications.controller.ts  (GET listado/unread-count + PATCH :id/read, dueño)
 ┃ ┃ ┃   ├ 📄 ws-auth.service.ts          (auth del handshake: JWT + re-consulta del user)
 ┃ ┃ ┃   ├ 📄 notifications.gateway.ts     (namespace /notifications, middleware auth, rooms user:<id>)
 ┃ ┃ ┃   ├ 📄 notifications.repository.ts / typeorm-notifications.repository.ts
 ┃ ┃ ┃   └ 📂 entities/
 ┃ ┃ ┣ 📂 scraping/            🔹 M7+M9: cron → cola ingest (worker) → evento → cola notify (API)
 ┃ ┃ ┃   ├ 📄 scraping.controller.ts   (POST /scraping/ingest, GET /scraping/state + /scraping/worker, admin)
 ┃ ┃ ┃   ├ 📄 scraping-events.controller.ts  (M9: @EventPattern job-offer.created → encola notify)
 ┃ ┃ ┃   ├ 📄 scraping.service.ts      (API: enqueueNotify / processNotification — no conoce fuentes)
 ┃ ┃ ┃   ├ 📄 scraping-worker.service.ts  (M9: enqueueIngest / extractSource — publica job-offer.created)
 ┃ ┃ ┃   ├ 📄 scraping-worker.controller.ts (M9: @MessagePattern scraping.ping / scraping.ingest)
 ┃ ┃ ┃   ├ 📄 scrape.events.ts         (M9: OFFER_CREATED_EVENT + OfferCreatedEvent)
 ┃ ┃ ┃   ├ 📄 circuit-breaker.ts       (closed/open/half-open por fuente — vive en el worker)
 ┃ ┃ ┃   ├ 📄 ingest.processor.ts / notify.processor.ts  (workers: ingest en worker, notify en API)
 ┃ ┃ ┃   ├ 📄 ingest.scheduler.ts      (cron dinámico → solo encola)
 ┃ ┃ ┃   └ 📄 sources.ts               (fuentes deterministas, upsert idempotente)
 ┃ ┃ ┗ 📂 health/             🔹 Health check + ping a Postgres (@nestjs/terminus)
 ┃ ┣ 📄 app.module.ts         🔹 Módulo raíz + Throttler + BullModule.forRootAsync(+Redis) + APP_GUARDs + APP_INTERCEPTORs
 ┃ ┗ 📄 main.ts               🔹 Bootstrap de la aplicación
 ┣ 📂 scripts/                🔹 smoke.mjs (smoke autenticado contra el dist)
 ┣ 📄 docker-compose.yml      🔹 PostgreSQL 16 (host 5433) + Redis 7 (host 6379)
 ┣ 📂 docs/                   🔹 Documentación VitePress (13 módulos)
 ┣ 📂 test/                   🔹 e2e (52) + integration (5) + env.setup (dotenv previo)
 ┣ 📂 .github/workflows/      🔹 ci.yml (gate: lint→build→tests) + docs.yml (Pages)
 ┣ 📂 vitest.config.*.ts      🔹 Runners separados: unit / integration / e2e
 ┣ 📄 .env.example            🔹 Template de variables de entorno
 ┣ 📄 tsconfig.json           🔹 TypeScript strict mode
 ┗ 📄 package.json
```

### 📦 Estructura de carpetas **por feature**

| Capa                 | Responsabilidad                                                    |
| -------------------- | ------------------------------------------------------------------ |
| `*.controller.ts`    | Recibe request, delega, devuelve response — cero lógica de negocio |
| `*.service.ts`       | Lógica de negocio (una responsabilidad por service — SRP)          |
| `*.repository.ts`    | Acceso a datos detrás de interfaz (DIP, preparado para ORM)        |
| `dto/` + `entities/` | Contratos de entrada/salida y modelos de dominio                   |

---

## 🔧 Scripts

| Comando                    | Descripción                                     |
| -------------------------- | ----------------------------------------------- |
| `npm run start:dev`        | 🚀 Desarrollo con hot-reload                    |
| `npm run start:worker`     | 🧩 Arranca el microservicio worker (Módulo 9)   |
| `npm run start:prod`       | 🚀 Ejecutar build de producción                 |
| `npm run build`            | 🏗️ Compilar para producción                     |
| `npm run lint`             | 🔍 Lint con Oxlint                              |
| `npm run format`           | ✨ Formatear con Prettier                       |
| `npm run test`             | 🧪 Tests unitarios (Vitest)                     |
| `npm run test:integration` | 🧪 Tests de integración (Postgres real)         |
| `npm run test:e2e`         | 🧪 Tests end-to-end (requiere Postgres + Redis) |
| `npm run docs:dev`         | 📖 Documentación local                          |
| `npm run docs:build`       | 📖 Build estático de la documentación           |

### 🗄️ Base de datos

| Comando                         | Descripción                                             |
| ------------------------------- | ------------------------------------------------------- |
| `npm run db:up`                 | 🐘 Levantar PostgreSQL + Redis en Docker (5433/6379)    |
| `npm run db:down`               | 🐘 Bajar el contenedor                                  |
| `npm run db:migration:generate` | 🧬 Generar migración desde las entidades                |
| `npm run db:migration:run`      | 🧬 Aplicar migraciones                                  |
| `npm run db:seed`               | 🌱 Cargar datos de desarrollo                           |
| `npm run db:n1`                 | 📊 Demo N+1 (naive vs. joins)                           |
| `npm run db:txn-demo`           | 🛡️ Demo rollback ante SIGTERM a mitad de tx (Módulo 10) |
| `npm run smoke`                 | 🔥 Smoke autenticado (SMOKE_BASE, default `3456`)       |

---

## 📡 Endpoints

> **API versionada (Módulo 10):** todas las rutas HTTP de negocio viven bajo `/v1` (ej. `POST /v1/auth/login`). El **WebSocket** (`/notifications`) y `GET /health` quedan fuera del prefijo por diseño.

### Autenticación (`auth`)

| Método | Ruta                | Descripción                                                | Auth |
| ------ | ------------------- | ---------------------------------------------------------- | ---- |
| `POST` | `/v1/auth/register` | Registrar usuario (`role: 'user'`) y recibir par de tokens | —    |
| `POST` | `/v1/auth/login`    | Iniciar sesión → `{ accessToken, refreshToken, user }`     | —    |
| `POST` | `/v1/auth/refresh`  | Rotar refresh (cada uso invalida el anterior) → par nuevo  | —    |
| `POST` | `/v1/auth/logout`   | Invalidar el refresh en DB (`refresh_token_hash: null`)    | JWT  |
| `GET`  | `/v1/auth/me`       | Usuario autenticado (re-validado por request)              | JWT  |

> Register y login llevan **rate limit estricto** (`AUTH_THROTTLE_LIMIT` por ventana) → `429 Too Many Requests`.

### Infraestructura

| Método | Ruta      | Descripción                            | Auth |
| ------ | --------- | -------------------------------------- | ---- |
| `GET`  | `/health` | Health check del proceso (memoria RSS) | —    |

### Empresas (`companies`)

| Método   | Ruta                | Descripción        | Auth          |
| -------- | ------------------- | ------------------ | ------------- |
| `GET`    | `/v1/companies      | Listar empresas    | —             |
| `GET`    | `/v1/companies/:id` | Obtener por ID     | —             |
| `POST`   | `/v1/companies      | Crear empresa      | `role: admin` |
| `PATCH`  | `/v1/companies/:id` | Actualizar empresa | `role: admin` |
| `DELETE` | `/v1/companies/:id` | Eliminar empresa   | `role: admin` |

### Ofertas laborales (`job-offers`)

| Método   | Ruta                 | Descripción                                                          | Auth          |
| -------- | -------------------- | -------------------------------------------------------------------- | ------------- |
| `GET`    | `/v1/job-offers      | Listar ofertas (paginación por cursor `?limit=&cursor=`)             | —             |
| `GET`    | `/v1/job-offers/:id` | Obtener por ID                                                       | —             |
| `POST`   | `/v1/job-offers      | Crear oferta (valida empresa, límite por fuente y `sourceUrl` única) | `role: admin` |
| `PATCH`  | `/v1/job-offers/:id` | Actualizar oferta (valida empresa si cambia `companyId`)             | `role: admin` |
| `DELETE` | `/v1/job-offers/:id` | Eliminar oferta                                                      | `role: admin` |

### Postulaciones (`applications`)

| Método  | Ruta                   | Descripción                                                                             | Auth |
| ------- | ---------------------- | --------------------------------------------------------------------------------------- | ---- |
| `GET`   | `/v1/applications      | Listar postulaciones del dueño (admin: todas) — oferta y empresa en 1 query (sin N+1)   | JWT  |
| `POST`  | `/v1/applications      | Postular con `jobOfferId` (userId del token; 409 duplicado, 409 sin slots)              | JWT  |
| `PATCH` | `/v1/applications/:id` | Cambiar estado — solo dueño o admin (`userId` del recurso vs. token o rol; 403 intruso) | JWT  |

### Notificaciones — REST (`notifications`) — Módulo 8

| Método  | Ruta                             | Descripción                                                           | Auth |
| ------- | -------------------------------- | --------------------------------------------------------------------- | ---- |
| `GET`   | `/v1/notifications               | Historial de notificaciones del dueño del token                       | JWT  |
| `GET`   | `/v1/notifications/unread-count` | Cantidad de pendientes de leer                                        | JWT  |
| `PATCH` | `/v1/notifications/:id/read`     | Marcar como leída — solo el dueño (ajena → 404, no revela existencia) | JWT  |

### Notificaciones — realtime (WebSocket) — Módulo 8

| Canal                | Detalle                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Namespace**        | `/notifications`                                                                                                                                      |
| **Evento**           | `notification.created` → `{ data: { notification: {...} } }`                                                                                          |
| **Conexión**         | Handshake autenticado con el mismo JWT del REST (`auth.token` o `Authorization: Bearer`) — sin token válido el handshake se rechaza (`connect_error`) |
| **Direccionamiento** | Cada socket entra al room `user:<id>`; los push solo llegan al dueño (nunca broadcast)                                                                |
| **Origen del id**    | El `userId` siempre deriva del token verificado en el handshake, nunca del cliente                                                                    |

> El flujo completo: el worker de `notify` (Módulo 7) persiste la notificación, `NotificationsService` emite `notification.created` (bus en proceso `EventEmitter2`) y `NotificationsGateway` lo traduce en un push dirigido — el dominio de negocio no conoce el transporte.

### Pipeline de scraping (`scraping`) — Módulo 7 + 9

| Método | Ruta                  | Descripción                                                                                                                                                                          | Auth          |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `POST` | `/v1/scraping/ingest` | Disparar una corrida de scraping a demanda (`source` y `force` opcionales) → 202. El API **delega el comando al microservicio worker** (`scraping.ingest`) y responde `{ enqueued }` | `role: admin` |
| `GET`  | `/v1/scraping/worker` | Salud del microservicio worker (ping `scraping.ping`): `{ status, worker: { ok, cron, sources, breaker } }` — `down` si expira                                                       | `role: admin` |
| `GET`  | `/v1/scraping/state`  | Cron, fuentes, conteos de cola (ingest/notify) y estado del worker                                                                                                                   | `role: admin` |

> **Dos procesos, una pipeline (Módulo 9):** el cron (`SCRAPE_CRON_EXPR`, default `0 */6 * * *`) vive en el **worker** y encola en la cola `ingest` (BullMQ); el worker procesa con circuit breaker + timeout, upsert idempotente por `sourceUrl` (`ON CONFLICT DO UPDATE`) y por cada oferta **nueva** publica el evento de dominio `job-offer.created` por **Redis transport**. El **API** lo consume (`@EventPattern`), encola su cola `notify` local y dispara el match por stack → notificaciones → push WS del Módulo 8.
>
> `POST /scraping/ingest` ya no encola directamente: envía el comando `scraping.ingest` al worker (`ClientProxy.send` + timeout 3s) y el worker encola. El API **jamás conoce** fuentes externas ni breakers; el worker **jamás conoce** NotificationsService ni sockets.

### Contrato de errores

Todas las respuestas de error usan la misma forma (via `AllExceptionsFilter`). **Desde el Módulo 5**, las respuestas _exitosas_ van envueltas en `{ data, meta: { timestamp, requestId } }` (TransformResponseInterceptor) y toda respuesta trae el header `x-request-id`:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "title",
      "message": "String must contain at least 3 character(s)"
    }
  ],
  "path": "/job-offers",
  "timestamp": "2026-09-04T21:10:37.982Z"
}
```

Las respuestas **exitosas** (200/201) llegan envueltas (Módulo 5):

```json
{
  "data": { "id": "…", "email": "demo@jobtrack.dev", "role": "user" },
  "meta": { "timestamp": "2026-09-04T21:10:37.982Z", "requestId": "…" }
}
```

Todos los curl de esta guía leen `data` (`jq .data`). El `requestId` de `meta` coincide con el header `x-request-id` de la respuesta.

| Código | Caso                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Validación fallida (o campo desconocido) / cursor de paginación inválido                                                        |
| `401`  | Sin token, token inválido/vencido, o refresh rotado/reutilizado (`InvalidCredentialsException`, `InvalidRefreshTokenException`) |
| `403`  | Rol insuficiente (`RolesGuard`, `@Roles('admin')`) o intento de editar postulación ajena (ownership)                            |
| `404`  | Recurso inexistente (`CompanyNotFoundException`, `JobOfferNotFoundException`, `ApplicationNotFoundException`) / id no-UUID      |
| `409`  | Conflicto de negocio (`DuplicateApplicationException`, `SlotsExhaustedException`, email/fuente/único)                           |
| `413`  | Body mayor a `1mb`                                                                                                              |
| `429`  | Rate limit superado (global o estricto de auth en register/login)                                                               |
| `500`  | Error no manejado (genérico en producción)                                                                                      |

---

## 🛠️ Stack Tecnológico

### Core

- 🐱 **NestJS 12** — Framework backend (DI, módulos, guards, interceptors)
- 🔷 **TypeScript** — Modo `strict: true`
- ⚡ **Node.js 22** — Runtime

### Calidad y API

- ✅ **Zod** — Validación de env vars y DTOs (pipes de validación + trim)
- 🐘 **PostgreSQL 16 + TypeORM** — Persistencia, migraciones versionadas, transacciones
- 🔐 **JWT + Passport + bcryptjs** — Auth (Módulo 4): access/refresh, rotation con hash, `jti` por firma
- 🧪 **Vitest + Supertest** — Pirámide completa (Módulo 6): 87 unit + 5 integration + 52 e2e (Postgres real, CI como gate)
- 🔄 **BullMQ + Redis 7** — Colas de trabajo (Módulo 7): cron → `ingest`/`notify`, reintentos con backoff, dedupe por `jobId`, circuito de falla por fuente
- ⚡ **Socket.IO + @nestjs/event-emitter** — Realtime (Módulo 8): push por rooms `user:<id>`, handshake autenticado con el JWT del REST, dominio desacoplado del transporte
- 🧩 **@nestjs/microservices** — Microservicios (Módulo 9): worker de scraping en proceso propio, transporte Redis para eventos (`job-offer.created`) y request-response (`scraping.ping`/`scraping.ingest`), un solo `REDIS_URL` para todo
- 🔍 **Oxlint + Prettier** — Linting y formato
- 🐶 **Husky + lint-staged** — Gates en pre-commit
- 🛡️ **@nestjs/throttler + helmet** — Rate limiting (429) y headers de seguridad (Módulo 10: `Referrer-Policy`, `Cross-Origin-Resource-Policy`, `Origin-Agent-Cluster`)
- 🚢 **Docker + GitHub Actions** — CI/CD (Módulo 11): imagen multi-stage (runtime sin devDependencies, no-root), compose del sistema completo, gate `audit` de runtime, push a GHCR y smoke contra el compose
- 🛡️ **Seguridad y resiliencia (Módulo 10)** — API versionada `/v1` (`/health` excluida), `enableShutdownHooks` con cierre ordenado del `ClientProxy` Redis (`CloseRedisClientOnShutdown`), demo verificable de rollback ante SIGTERM (`npm run db:txn-demo`) y [checklist OWASP](docs/guide/security-checklist.md)
- 📊 **Observabilidad** — `AsyncLocalStorage` + `x-request-id`, log JSON por request, respuestas `{ data, meta }`
- 💓 **@nestjs/terminus** — Health checks (incluye ping a la base)

---

## 📅 Roadmap de Aprendizaje

> 🎯 **Criterio de completado:** avanza al siguiente módulo solo cuando puedas **explicar el anterior en voz alta sin mirar el código**.

| Módulo | Tema                                    | Estado        |
| ------ | --------------------------------------- | ------------- |
| 0      | Fundamentos y setup del proyecto        | ✅ Completado |
| 1      | Módulos, DI e inyección de dependencias | ✅ Completado |
| 2      | DTOs, validación, pipes y errores       | ✅ Completado |
| 3      | Persistencia: PostgreSQL y migraciones  | ✅ Completado |
| 4      | Auth JWT, Guards y RBAC                 | ✅ Completado |
| 5      | Interceptors y observabilidad           | ✅ Completado |
| 6      | Testing: la pirámide completa           | ✅ Completado |
| 7      | Scheduling, colas y scraping            | ✅ Completado |
| 8      | WebSockets en tiempo real               | ✅ Completado |
| 9      | Microservicios (opcional)               | ✅ Completado |
| 10     | Seguridad avanzada y OWASP              | ✅ Completado |
| 11     | CI/CD, Docker y despliegue              | ✅ Completado |
| 12     | Cierre de portafolio                    | ⏳ Pendiente  |

### 🌿 Convención de ramas Git

Cada módulo se desarrolla en su propia rama y se integra a `main` al cerrarlo:

```bash
git checkout -b module-01-foundations
# ... trabajar el módulo ...
git commit -am "feat(module-01): CRUD job-offers en memoria"
git checkout main && git merge module-01-foundations
```

---

## 🌿 Flujo de Trabajo con Git

```bash
# Ver ramas
git branch

# Crear rama de feature desde main
git checkout -b feature/modulo-x

# Commitear con convención
git add .
git commit -m "feat: agregar módulo de validation"

# Integrar a main
git checkout main
git merge feature/modulo-x

# Publicar
git push origin main
```

### 📝 Convención de commits

| Tipo       | Ejemplo                                  | Uso                                   |
| ---------- | ---------------------------------------- | ------------------------------------- |
| `feat`     | `feat: agregar CRUD de job-offers`       | Nueva funcionalidad                   |
| `fix`      | `fix: corregir validación de DTO`        | Corrección de bugs                    |
| `docs`     | `docs: actualizar README`                | Cambios de documentación              |
| `refactor` | `refactor: extraer NotificationsService` | Refactor sin cambio de comportamiento |
| `chore`    | `chore: actualizar dependencias`         | Tareas de mantenimiento               |
| `style`    | `style: aplicar formato`                 | Cambios de formato                    |

---

## 🚢 Despliegue

> 🌐 **Deploy en vivo:** `https://jobtrack-api.<proveedor>.<tu-dominio>/health` → `<llenar cuando el repo esté en GitHub y el proveedor mapee los secrets>`

### 📖 Documentación (GitHub Pages)

El workflow `.github/workflows/docs.yml` publica la guía VitePress automáticamente al pushear a `main`:

1. Crear el repositorio en GitHub.
2. Activar **Settings → Pages → Source: GitHub Actions**.
3. Pushear a `main` → `https://<peteraraya>.github.io/jobtrack-api`.

### 🐳 API — Docker y CI/CD (Módulo 11)

- **`Dockerfile` multi-stage**: `deps` (todo) → `build` (`nest build` + `npm prune --omit=dev`) → `runtime` (alpine, usuario no-root, solo `dist/` + prod node_modules → las vulns del dev tooling no viajan a la imagen).
- **`docker-compose.yml` completo**: API + worker de scraping (Módulo 9) + Postgres + Redis con healthchecks; **un comando** levanta todo (`docker compose up --build -d`).
- **Entrypoint** (`scripts/docker-entry.mjs`): decide proceso por `APP_PROCESS` (api|worker), corre las **migraciones** idempotentes con retry y reenvía señales para el graceful shutdown del Módulo 10.
- **`.github/workflows/ci.yml`**: gate (lint → build → unit → integration → e2e) + `npm audit` (solo runtime, falla en high+) + build de imagen con push a **GHCR** en `main` + **smoke contra el compose** (el mismo artefacto que se despliega).
- **`.github/dependabot.yml`**: escaneo semanal de npm + mensual de actions.
- **Deploy a Railway / Render / Fly**: usar el `Dockerfile` (multi-stage) como build y mapear estos secrets del proveedor:
  `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (≥10 chars), `CORS_ORIGINS`, `JOB_SOURCES`, `SCRAPE_*`.

---

## 🧠 Preparación para Entrevistas

Cada módulo de esta guía incluye **retos tipo entrevista** con ejemplos reales del repositorio. Para las preguntas de un **líder técnico** (arquitectura, rendimiento, seguridad, operación y el "cuéntame de ti") sumergite en la guía dedicada: [**Preguntas de líder técnico**](docs/guide/tech-lead-questions.md).

- [x] ¿Puedo explicar DI y scopes de provider sin mirar código?
- [x] ¿Puedo explicar la diferencia entre Guard, Interceptor, Pipe y Filter, y su orden de ejecución?
- [x] ¿Tengo un ejemplo propio de correlación por `requestId` (`AsyncLocalStorage` + `x-request-id`)?
- [x] ¿Tengo un ejemplo propio de un N+1 que detecté y resolví? (`npm run db:n1`)
- [x] ¿Puedo explicar JWT + refresh rotation y por qué el refresh se guarda hasheado?
- [x] ¿Tengo un ejemplo propio de verificación de ownership (no solo rol)?
- [x] ¿Puedo explicar la pirámide de testing con ejemplos reales de mi propio repo? (unit 87 + integration 5 + e2e 52 + CI como gate)
- [x] ¿Puedo mostrar un test que falla si vuelve el N+1 midiendo número de queries?
- [x] ¿Puedo explicar por qué el retry de un job de scraping es seguro (idempotencia por `sourceUrl` con `ON CONFLICT DO UPDATE`) y qué papel juega el circuit breaker?
- [x] ¿Tengo un ejemplo propio de cron que encola y de worker desacoplado que procesa, con reintentos y backoff?
- [x] ¿Puedo explicar el canal realtime: bus de eventos en proceso (`EventEmitter2`) → gateway Socket.IO → rooms `user:<id>`, y por qué el dominio no conoce el transporte?
- [x] ¿Puedo explicar por qué el handshake WS se autentica con middleware (`connect_error` determinista) y no rechazando en `handleConnection`?
- [x] ¿Puedo justificar cuándo _no_ usar microservicios, con un ejemplo propio?
- [x] ¿Puedo explicar el desacople worker ↔ API del Módulo 9: evento de dominio (`job-offer.created`) vs comando de trabajo (cola BullMQ `ingest`), request-response (`scraping.ping`) vs event-based (`emit`), y por qué el worker no conoce notificaciones ni el API conoce fuentes?
- [x] ¿Puedo explicar el multi-stage de mi Dockerfile y por qué el runtime no trae devDependencies? (podas con `npm prune --omit=dev`; usuario no-root)
- [x] ¿Puedo explicar qué valida mi CI completo y cómo el smoke prueba el artefacto real (compose), no solo `npm test`?
- [x] ¿Puedo explicar el trade-off del micromonolito local (dos procesos, una máquina): desacople y escalabilidad del worker a cambio de complejidad operacional y latencia de red?

---

## 📚 Recursos

- 🐱 [Documentación oficial de NestJS](https://docs.nestjs.com/)
- ✅ [Zod](https://zod.dev/)
- 🧪 [Vitest](https://vitest.dev/)
- 🔍 [Oxlint](https://oxc.rs/)
- 💓 [@nestjs/terminus](https://docs.nestjs.com/recipes/terminus)
- ⚡ [Socket.IO](https://socket.io/)
- 📖 [VitePress](https://vitepress.dev/)

---

## 🧑‍💻 Contribuir

Este es un proyecto de **aprendizaje personal**, pero si encontrás errores, mejoras o querés aportar a un módulo, tu contribución es bienvenida. Abrí un _issue_ o enviá un _pull request_.

---

<div align="center">

**🚀 JobTrack API — Backend NestJS de cero a production-ready**

Desarrollado por [**Pedro Araya Gálvez**](https://pedroaraya.vercel.app/)

⭐ Si te resultó útil este proyecto, ¡dale una estrella! ⭐

</div>
