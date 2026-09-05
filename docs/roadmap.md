# Hoja de Ruta NestJS — Documento Original

> Esta página reproduce el roadmap original completo. Para la guía interactiva por módulos, usá el [sidebar izquierdo](/guide/intro).

## Cómo usar este documento

Este plan combina **guía de estudio** + **plan de proyecto único y progresivo**. No construís 10 proyectos de juguete: construís **una sola API real**, `JobTrack API`, y en cada módulo le agregás una capa de complejidad. Al final tenés:

- Un repositorio de portafolio con historial de commits que cuenta una historia de aprendizaje coherente.
- Una API que resuelve un problema real y personal: agregar ofertas laborales, gestionar postulaciones con estados, y recomendar ofertas según tu perfil.
- Cobertura de todos los temas que un entrevistador técnico senior de NestJS espera: DI, módulos, guards, interceptors, pipes, filters, microservicios, WebSockets, testing, y arquitectura limpia.

**Duración estimada:** 10–14 semanas a ritmo de 10–12 hrs/semana (ajustable).

**Convención de ramas Git:** cada módulo vive en su propia rama (`module-01-foundations`, `module-02-validation`, …) que mergeás a `main` al cerrar el módulo.

## Dominio del proyecto: JobTrack API

| Entidad        | Descripción                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `User`         | Usuario de la plataforma (el buscador de empleo)                                                                     |
| `Profile`      | Perfil profesional: stack, años de experiencia, CV parseado                                                          |
| `JobOffer`     | Oferta laboral agregada (de scraping o carga manual)                                                                 |
| `Application`  | Postulación de un `User` a un `JobOffer`, con estado (`applied`, `interview`, `technical_test`, `offer`, `rejected`) |
| `Company`      | Empresa asociada a una oferta                                                                                        |
| `Notification` | Notificación al usuario (nueva oferta relevante, cambio de estado)                                                   |

## Módulo 0 — Fundamentos y setup del proyecto (3–4 días)

### Conceptos

- Arquitectura de Nest: decoradores, metadata reflection, grafo de dependencias.
- CLI de Nest (`nest new`, `nest g module/controller/service`).
- Estructura de carpetas **por feature**.
- Diferencia entre `main.ts`, `AppModule` y módulos de feature.

### Ejercicios

1. Inicializá `jobtrack-api` con Nest CLI, TypeScript en modo `strict: true`.
2. Configurá ESLint + Prettier + Husky (pre-commit: lint + format) + lint-staged.
3. Configurá `@nestjs/config` con validación de esquema al arrancar (Zod) — la app no debe levantar si falta una env var crítica.
4. Creá el módulo `health` con `@nestjs/terminus` — endpoint `/health`.

### Mejores prácticas

- Sin `any` implícito ni explícito sin justificación documentada.
- `.env.example` versionado, `.env` real en `.gitignore`.
- README inicial con instrucciones de setup.

### Entregable

[→ Ver implementación completa](/guide/module-00) · Proyecto que levanta con `npm run start:dev`, responde en `/health`, con lint y format automatizados en pre-commit.

## Módulo 1 — Módulos, controladores, providers e inyección de dependencias (5–7 días)

### Conceptos

- DI: contenedor de IoC, token por clase vs. token custom (`@Inject('TOKEN')`).
- Scopes: `DEFAULT`, `REQUEST`, `TRANSIENT`.
- Módulos: `imports`, `exports`, `providers`, `controllers`; módulos dinámicos.
- Controladores: solo request/response, cero lógica.
- Patrón **Controller → Service → Repository**.

### Ejercicios

1. Módulo `job-offers` con CRUD completo en memoria.
2. Módulo `companies`; `JobOffersModule` importa `CompaniesModule` (practica `exports`/`imports`).
3. **Reto:** provider con token custom `@Inject('JOB_SOURCE_CONFIG')` — patrón "puerto" desacoplado.
4. Reproducí a propósito y documentá el error de provider duplicado sin exportar.

### Entregable

CRUD en memoria verificable en el grafo de Nest.

## Módulo 2 — DTOs, validación, pipes y manejo de errores (5–7 días)

### Conceptos

- DTOs como contrato; nunca exponer la entidad en la respuesta.
- `ValidationPipe` global vs. pipes custom.
- Filtros de excepción: dominio vs. `HttpException`.
- Error de validación (400) vs. error de negocio (422/409).

### Ejercicios

1. `CreateJobOfferDto` / `UpdateJobOfferDto` con `class-validator` o `nestjs-zod`.
2. `ValidationPipe` global con `whitelist: true` y `forbidNonWhitelisted: true`.
3. `AllExceptionsFilter` global.
4. **Reto:** `DuplicateApplicationException` → 409 Conflict.
5. `TrimPipe` custom.

### Entregable

Todos los endpoints validan estrictamente y devuelven errores consistentees.

## Módulo 3 — Persistencia: PostgreSQL, TypeORM/Prisma, relaciones y migraciones (7–10 días)

### Conceptos

- ORM: TypeORM o Prisma (documentá por qué).
- Relaciones: `OneToMany`, `ManyToMany`, `OneToOne`.
- Migraciones versionadas vs. `synchronize: true`.
- Patrón Repository detrás de interfaz.
- Transacciones explícitas.

### Ejercicios

1. Postgres real (Docker Compose).
2. 6 entidades con relaciones e índices.
3. Paginación (`limit`/`cursor`) en `GET /job-offers`.
4. **Reto N+1:** `GET /applications` sin loop de queries.
5. Transacción: crear `Application` + decrementar `slots` en `JobOffer`.

### Entregable

Persistencia real, sin N+1 demostrables, con transacción documentada.

## Módulo 4 — Autenticación (JWT) y autorización (Guards, RBAC) (7–10 días)

### Conceptos

- Guards de auth vs. autorización (separados).
- Access token corto + refresh token largo, rotado y hasheado.
- Passport + JWT.
- RBAC vs. ABAC/ownership.
- Decoradores custom y metadata reflection.

### Ejercicios

1. Registro/login con `bcrypt`/`argon2`.
2. `JwtAuthGuard` + `RolesGuard` componibles.
3. Roles `admin` y `user`.
4. **Reto ownership:** `PATCH /applications/:id` verifica el dueño.
5. Refresh token rotation.
6. Rate limiting con `@nestjs/throttler`.

### Entregable

Auth completo + tests de cada caso negativo.

## Módulo 5 — Interceptors, middleware y observabilidad (5–6 días)

### Conceptos

- Middleware vs. Interceptors.
- Correlation ID por request.
- Logging JSON estructurado.
- Interceptors para `{ data, meta }` y tiempos.

### Ejercicios

1. `RequestIdMiddleware` (UUID por request).
2. `LoggingInterceptor` (método, ruta, status, duración, requestId).
3. `TransformResponseInterceptor` → `{ data, meta }`.
4. **Reto:** explicar el orden real: Middleware → Guard → Interceptor(pre) → Pipe → Handler → Interceptor(post) → Filter.

### Entregable

Requests trazables end-to-end; respuestas con contrato consistente.

## Módulo 6 — Testing: la pirámide completa (7–9 días)

### Conceptos

- Unit (Vitest, sin Nest ni DB).
- Integration (`Test.createTestingModule` + DB real).
- E2E (Supertest, app HTTP completa).
- Cobertura como guía.

### Ejercicios

1. Unit tests de `ApplicationsService`.
2. Integration test del módulo `applications`.
3. E2E del flujo completo de auth (feliz + 401 + 403).
4. **Reto:** test del N+1 (assert sobre nº de queries).
5. CI (GitHub Actions) como gate: lint → typecheck → unit → integration → e2e.

### Entregable

Pirámide completa corriendo en CI con flujos críticos cubiertos.

## Módulo 7 — Scheduling, colas y el corazón del scraping (7–9 días)

### Conceptos

- `@nestjs/schedule` para cron jobs.
- BullMQ + Redis para trabajo pesado.
- Cron simple vs. cola con workers.
- Idempotencia.

### Ejercicios

1. Cron diario que dispara la agregación.
2. Scraping en cola BullMQ (cron solo encola).
3. Upsert idempotente por URL/hash.
4. **Reto:** retries con backoff exponencial + idempotency key.
5. Notificación automática cuando una oferta matchea un perfil.

### Entregable

Pipeline de scraping en background, idempotente y resiliente.

## Módulo 8 — WebSockets: notificaciones en tiempo real (5–6 días)

### Conceptos

- `@nestjs/websockets` + Socket.IO.
- Autenticación del handshake.
- Rooms/namespaces (no broadcast global).

### Ejercicios

1. `NotificationsGateway` → `notification.new`.
2. Auth de socket con el mismo JWT.
3. **Reto:** `application.statusChanged` sin polling.

### Entregable

Notificaciones y cambios de estado en tiempo real, con socket autenticado.

## Módulo 9 — Microservicios (opcional) (6–8 días)

### Conceptos

- `@nestjs/microservices`: TCP, Redis, NATS, RabbitMQ.
- Cuándo sí / cuándo no.
- Request-response vs. event-based.

### Ejercicios

1. Worker de scraping como microservicio con RabbitMQ/Redis.
2. Evento `job-offer.created`.
3. **Reto:** documentá ganancias y costos con honestidad.

### Entregable

Servicio extraído con trade-off documentado.

## Módulo 10 — Seguridad avanzada, resiliencia y checklist OWASP (4–5 días)

### Conceptos

- OWASP Top 10 aplicado.
- Graceful shutdown.
- Secrets management.

### Ejercicios

1. Checklist OWASP documentado.
2. `app.enableShutdownHooks()` con cierre ordenado.
3. **Reto:** `SIGTERM` a mitad de una transacción.

### Entregable

OWASP documentado, shutdown graceful, API versionada.

## Módulo 11 — CI/CD, Docker y despliegue (5–7 días)

### Conceptos

- Dockerfile multi-stage.
- Pipeline completo.
- Staging vs. producción.

### Ejercicios

1. Dockerfile multi-stage.
2. Docker Compose completo (API + Postgres + Redis).
3. GitHub Actions: gates + build + registry.
4. Deploy público (Railway, Render, Fly.io).

### Entregable

JobTrack API desplegada con CI/CD verde.

## Módulo 12 — Cierre de portafolio (3–4 días)

### Tareas

1. README final (problema, arquitectura, trade-offs, setup 1 comando, link).
2. 3–5 "war stories".
3. Walkthrough de 5–7 min.

### Entregable final

Repositorio público, deploy en vivo, README completo, historias listas para entrevista.

## Guía rápida de preparación para entrevistas

- ¿Puedo explicar DI y scopes de provider sin mirar código?
- ¿Puedo explicar la diferencia entre Guard, Interceptor, Pipe y Filter, y el orden real de ejecución?
- ¿Tengo un ejemplo propio de un N+1 que detecté y resolví?
- ¿Puedo explicar JWT + refresh rotation y por qué el refresh se guarda hasheado?
- ¿Tengo un ejemplo propio de verificación de ownership (no solo rol)?
- ¿Puedo justificar cuándo _no_ usar microservicios, con un ejemplo propio?
- ¿Puedo explicar la pirámide de testing con ejemplos reales de mi propio repo?
- ¿Tengo al menos una "war story" de un bug de concurrencia o de una transacción fallida?

## Checklist de arquitectura (cada módulo nuevo)

- ¿El DTO valida todos los campos y rechaza los no declarados?
- ¿El endpoint tiene guard de auth + rol/ownership si corresponde?
- ¿Los errores evitan filtrar detalles internos?
- ¿Hay rate limiting en endpoints sensibles?
- ¿La operación multi-paso está en una transacción?
- ¿El listado tiene paginación?
- ¿Hay test del caso feliz y de al menos un caso de error/permiso?
- ¿Se loguea sin exponer datos sensibles?
