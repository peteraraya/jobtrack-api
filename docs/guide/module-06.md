# Módulo 6 — Testing: la pirámide completa

> **Estado:** ✅ Completo · **Duración estimada:** 7–9 días
> **Rama de git sugerida:** `module-06-testing`

## Conceptos clave

- **La pirámide de testing**: muchos tests unitarios (rápidos, sin infraestructura, lógica aislada) → algunos tests de integración (con la infraestructura real: Postgres) → pocos e2e (contrato HTTP completo de punta a punta).
- **Unit tests** (Vitest): mockean repositorios y dependencias; la lógica de negocio pura corre sin Nest ni DB.
- **Integration tests**: el módulo completo (`AppModule` real) con **Postgres real** — ejercitan el `Service + Repository` junto, sin pasar por HTTP. Son el middle de la pirámide.
- **E2E tests** (Supertest): contra la app HTTP completa — guards, pipes, filters y el contrato real de la API, incluidos los casos de error.
- **Cobertura como guía, no meta ciega**: priorizá lógica de negocio y casos límite de seguridad; un getter trivial con `100%` no vale lo que un `401/403/409` bien testeado.
- **Determinismo**: ni `Date.now()` sin mockear, ni dependencia del orden de ejecución entre tests. Cada e2e cría su propia app y dropea el esquema (`synchronize(true)`), así no hay estado compartido.

## Lo que se implementó

### 1. División de runners por capa (configs de Vitest)

Un solo `vitest.config.ts` con `**/*.spec.ts` atrapaba cualquier test futuro en `test/` — ahora cada capa tiene su propio runner para que la pirámide quede explícita y no se ensucien los tiempos:

| Capa        | Config                         | Incluye                              | Script                     |
| ----------- | ------------------------------ | ------------------------------------ | -------------------------- |
| Unit        | `vitest.config.ts`             | `src/**/*.spec.ts` (junto al fuente) | `npm test`                 |
| Integración | `vitest.config.integration.ts` | `test/**/*.integration-spec.ts`      | `npm run test:integration` |
| E2E         | `vitest.config.e2e.ts`         | `**/*.e2e-spec.ts`                   | `npm run test:e2e`         |

### 2. Unit tests (base de la pirámide)

Los 46 unit tests de `src/` cubren la lógica con repos mockeados. Los casos pedidos por el roadmap ya existían en `applications.service.spec.ts`:

- `apply()` crea con el `userId` del token y delega en el repo → `DuplicateApplicationException` si ya postuló.
- `apply()` con oferta inexistente → `NotFoundException`.
- `updateStatus()`: dueño puede, intruso recibe `ForbiddenException` (aunque adivine el id), admin puede, 404 si no existe, e idempotencia (mismo estado → no re-escribe).

### 3. Integration tests — `test/integration/applications.integration-spec.ts`

Compilan `AppModule` completo (sin HTTP) y sincronizan el esquema real antes de cada test. Verifican la **lógica con la infraestructura real**, cosas que un unit con mocks no puede garantizar:

- `apply()` crea la postulación y **decrementa los cupos en la misma transacción** (verifica el valor en DB, `slots: 3 → 2`).
- Duplicado → `DuplicateApplicationException`.
- Oferta inexistente → `JobOfferNotFoundException` **y rollback**: no queda ninguna fila a medias.
- `slots: 0` → `SlotsExhaustedException` y cupos **nunca negativos** (condición atómica `slots > 0`).

### 4. Reto tipo entrevista: testear el N+1 midiendo queries

El reto pedía assert sobre el **número de queries**, no solo sobre el resultado. Se logra interceptando el driver: como TypeORM usa `pg`, se patchea `pg.Client.prototype.query` (un solo punto de paso para TODAS las queries, incluida dentro de transacciones) y se cuentan los `SELECT` emitidos:

```ts
const queries: string[] = [];
const original = pg.Client.prototype.query as unknown as (
  ...args: unknown[]
) => unknown;
pg.Client.prototype.query = function patched(
  this: pg.Client,
  ...args: unknown[]
): unknown {
  const text =
    typeof args[0] === 'object' ? (args[0] as { text?: string }).text : args[0];
  if (typeof text === 'string') queries.push(text);
  return original.apply(this, args);
} as pg.Client['query'];
// ... seed 3 postulaciones, reseteamos el contador y leemos:
const all = await applicationsService.findAllWithDetails();
expect(all).toHaveLength(3); // resultado correcto
expect(all.every((it) => it.jobOffer?.company)).toBe(true); // jerarquía cargada
expect(selects).toHaveLength(1); // UNA query con joins, nada de 1 + N
```

Si el repo volviera a la versión con N+1, este test **fallaría aunque el resultado sea idéntico** — exactamente el caso que el roadmap pide demostrar.

### 5. E2E del flujo completo de auth

Se agregó un test fino que encadena afuera lo que antes estaba picado en tests individuales:

```
register (201, role=user) → login (201, tokens) → GET /auth/me (200, userId)
→ GET /auth/me sin token (401) → POST /companies como user (403, RBAC)
→ POST /companies como admin (201)
```

Un solo test que recorre la historia completa: registro, sesión, identidad, 401 pre-token y 403 por rol — el "happy path de una entrevista" en una secuencia.

### 6. CI como gate obligatorio — `.github/workflows/ci.yml`

Pipeline de GitHub Actions que corre en **cada PR y push a main**, con Postgres como _service container_ (en el mismo puerto 5433 que el compose local):

```
lint (oxlint) → build → unit → integration → e2e
```

El job expone `DATABASE_URL` apuntando al service container. Sin `.env` en CI: `dotenv/config` del setup lee env vars reales. Este workflow es la base sobre la que el Módulo 11 agrega build de imagen + deploy.

## Mejores prácticas aplicadas

- ✅ Pirámide completa en tres runners separados y verificables por separado.
- ✅ Unit: lógica pura con mocks (rápidos, 46 en ~4s).
- ✅ Integration: infraestructura real (transacciones, constraints, rollback) sin pasar por HTTP.
- ✅ E2E: contrato HTTP completo, incluidos 401/403/409 y errores sin envolver.
- ✅ Reto N+1 resuelto con medición real de queries (no solo el resultado).
- ✅ CI como gate: nadie mergea código que no pase lint + tests + build.
- ✅ Tests deterministas: DB aislada por test (`synchronize(true)`), sin estado compartido.
- ✅ El contrato `{ data, meta }` del M5 se testea explícitamente → cambios de contrato rompen en CI.

## Verificación del entregable

```bash
npm run build             # compila
npm run lint              # 0 warnings, 0 errors
npm test                  # 46 unit → all passed
npm run test:integration  # 5 integration → all passed (requiere Postgres en 5433)
npm run test:e2e          # 41 e2e → all passed (requiere Postgres en 5433)
```

Anterior: [Módulo 5](/guide/module-05) · Siguiente: [Módulo 7](/guide/module-07)
