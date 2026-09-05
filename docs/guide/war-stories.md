# War stories — historias técnicas para la entrevista

> Módulo 12 — el portafolio no vende código, vende **cómo pensás**. Cada historia sigue la misma estructura para que la cuentes en 60 segundos: **contexto → qué pasó → cómo lo resolví → qué aprendí → dónde está en el repo**.

---

## 1. El N+1 en `GET /applications` que se veía "perfecto" en el postman

**Contexto.** El endpoint `GET /applications` devuelve cada postulación con su oferta y la empresa de esa oferta. Con dos postulaciones el Postman se veía perfecto. Hasta que medí las queries.

**Qué pasó.** La implementación ingenua hacía `findOne` por aplicación y luego resolvía `jobOffer` y detrás `company` — **1 + 2N queries**. Con cientos de postulaciones el endpoint se caía de gráfica y "andaba" solo porque devolvía poco.

**Cómo lo resolví.** Moví el acceso a datos detrás de un repositorio (`ApplicationsRepository` → adaptador `TypeOrmApplicationsRepository`) y el query quedó en **una sola** con joins explícitos:

```ts
this.applicationRepository.find({
  where: userId ? { userId } : {},
  relations: { jobOffer: { company: true } },
  order: { createdAt: 'DESC' },
});
```

Después lo **cerré con un test que falla si vuelve el N+1**: un `QueryCounterLogger` que cuenta queries reales en el test de integración, y el demo `npm run db:n1` compara "naive vs. eager" midiendo queries.

**Qué aprendí.** _"Anda" y "es escalable" son cosas distintas. La optimización sin medición es adivinación; el N+1 se caza contando queries, no mirando el tiempo de una respuesta chica._

**Dónde está.** `src/modules/applications/typeorm-applications.repository.ts:99` · `src/database/n1-comparison.ts` · test de integración con contador de queries.

---

## 2. De cron ingenuo a colas + circuit breaker (cambio de rumbo)

**Contexto.** El scraping arrancó como un cron que cuanto algo se encolaba procesaba inline: "una función que corre cada X horas". Al primer fallo real se notó el problema.

**Qué pasó.** Un cron que scrapea sincrónicamente tiene tres fallas de diseño: (1) un fetch lento atrasa **toda** la corrida, (2) una fuente caída arrastra las demás (sin aislamiento), (3) si el proceso muere a mitad, el trabajo se pierde sin rastro ni reintento.

**Cómo lo resolví.** Rediseño en dos capas (Módulo 7) y luego se extrajo al worker (Módulo 9):

- El scheduler **es el productor**: encola trabajos en BullMQ (cola `ingest`) con `jobId` estable — naturalmente deduplicados entre corridas; `force` los saltea.
- Cada **fuente tiene su propio circuit breaker** (`SCRAPE_BREAKER_THRESHOLD`/`COOLDOWN`): una fuente en llamas no contamina a las demás.
- El worker procesa con reintentos y **backoff exponencial**, y el upsert es idempotente por `sourceUrl` (`ON CONFLICT DO UPDATE`) — reintentar es seguro.

**Qué aprendí.** _Un cron es el "mock" de un sistema de trabajo; cuando el trabajo es pesado y falla, necesitás reintento, backoff, dedup y aislamiento por unidad de trabajo — eso es una cola._

**Dónde está.** `src/modules/scraping/ingest.scheduler.ts` · `ingest.processor.ts` · `scrape.types.ts` (config del breaker) · e2e que verifica dedup y breaker.

---

## 3. El refresh token que se guardaba… como secret

**Contexto.** La auth usa access (15m) + refresh (7d) con **rotación**. El refresh viven en la DB para poder invalidarlo.

**Qué pasó.** La primera implementación guardaba el refresh en claro. Cualquiera con acceso a la base podía emitir sessions. Peor: sin rotación, un refresh robado era válido para siempre hasta caducar.

**Cómo lo resolví.** (a) En DB solo se guarda el **hash** del refresh (`refresh_token_hash`), nunca el valor. (b) Cada uso **rota**: el refresh recibido se invalida y se emite un par nuevo — un refresh reutilizado devuelve `401` y mata la sesión. (c) El logout anula. Todo cerrado con un e2e que demuestra el caso negativo: _"reutilizar el refresh ya rotado → 401"_ y _"el hash no se puede invertir"_.

**Qué aprendí.** _La rotación convierte el login en un patrón "anti-robos": no alcanza con firmar bien, hay que hacer que el secreto pierda valor con cada uso. Y los tests negativos del e2e son los que prueban seguridad real._

**Dónde está.** `src/modules/users/entities/user.entity.ts` (`refresh_token_hash`) · `src/modules/auth/` · e2e `auth` (27 tests de auth incluida rotación/reutilización).

---

## 4. `synchronize: true` te come la cintura: el bug del volumen que casi rompe el primer `docker compose up`

**Contexto.** En desarrollo y en tests el esquema se crea con `synchronize` (conveniente). En producción: OFF — el esquema vive en **migraciones versionadas** y se aplica con `migration:run`. El Módulo 11 agregó el despliegue por contenedores.

**Qué pasó.** Primer `docker compose up` real… y el contenedor del API se quedó reintentando migraciones que fallaban una y otra vez con `relation "application" already exists`. El problema era sutil: el volumen de Postgres **ya tenía las tablas** (las había creado un seed/test de antes contra el mismo contenedor) pero **no tenía la tabla de historial `migrations`** → TypeORM intentaba crear todo desde cero y chocaba contra las tablas existentes. No era un bug del Dockerfile: era el típico _schema que "casi está"_.

**Cómo lo resolví.** Primero, diagnóstico: las migraciones no son "el esquema actual", son **el log de cambios**. Contra una base con esquema previo (sin historial) la migración no puede reconciliar sola. El fix operativo fue arrancar de cero limpio (`docker compose down -v`, que es también lo que hace el CI en cada corrida) para probar el único escenario que la migración promete: **de BD vacía a esquema versionado**. Además, el entrypoint corre las migraciones con reintento acotado (por si Postgres todavía está arrancando), porque "depende del healthcheck" no alcanza cuando el esquema previo es ambiguo.

**Qué aprendí.** _Sincronizar en tests está perfecto; en despliegue, una base con esquema pero sin historial de migraciones es más peligrosa que una vacía. Las migraciones hay que probarlas siempre desde cero — y `synchronize:false` en producción es una política, no una preferencia._

**Dónde está.** `src/config/database.ts` (`synchronize: false`) · `src/database/migrations/` · `scripts/docker-entry.mjs` (retry) · `docker-compose.yml` · job CI `smoke-containers` (fresh volume).

---

## 5. La decisión más opinable: el micromonolito del Módulo 9

**Contexto.** El pipeline de scraping tenía un claro candidato a extracción: el worker (fetch con breaker + upsert) no necesita el API request/response. La tentación era "microservicios por moda". La alternativa era "todo en una cola".

**Qué pasó / qué decidí.** Separé el worker como **proceso independiente** en la misma máquina — micromonolito local — con **dos canales semánticos** para el mismo flujo:

1. **Comando** (cola BullMQ `ingest`): "hacé este trabajo" — reintentos/backoff, dedup por `jobId` estable.
2. **Evento** (Redis transport, `job-offer.created`): _el dominio propagado_ — el worker lo **publica** (fire-and-forget, nadie responde), el API lo consume (`@EventPattern`) y encola su cola `notify` local.

**Cómo lo hice bien:** el contrato no menciona el dominio interno del API (`OfferCreatedEvent` = `{ offer: { id, title, stack } }`); el `ClientProxy` se inyecta **por token** (`SCRAPING_WORKER_CLIENT`) para que los unit tests no abran Redis; request-response con timeout 3s (el admin nunca cuelga si el worker cayó); e2e bootea el worker **en el mismo proceso** después de purgar colas.

**Qué aprendí (el trade-off que se cuenta en entrevista).** _Desacople real y worker escalable a otra máquina *sin tocar contratos*, a cambio de: complejidad operacional (dos procesos que orquestar), latencia de red, y que el debugg local exige levantar ambos. Para el tamaño real de este sistema, el micromonolito es la elección honesta; la decisión queda lista para escalar sin reescribir contratos._

**Dónde está.** `src/main-scraper.ts` · `src/modules/scraping/scraping-worker.module.ts` · `scrape.events.ts` · `src/config/tokens.ts` · trade-off documentado en `docs/guide/module-09.md`.

---

## Bonus de bolsillo

- **WebSocket con auth en el handshake** (Módulo 8): autenticar con middleware y `connect_error` determinista en vez de rechazar en `handleConnection` — el cliente sabe **por qué** falló y el test lo cubre.
- **El e2e como contrato de despliegue** (Módulos 6 y 11): el smoke corre contra el **contenedor real**, no contra `nest start` — si el artefacto no anda cerrado en Docker, el CI lo atrapa en GitHub, no en producción.
- **El demo de SIGTERM a mitad de transacción** (Módulo 10): `npm run db:txn-demo` — "¿qué pasa si el proceso muere a mitad de una transacción?" ya no es una respuesta teórica: es un script que verifica contra Postgres que el rollback fue atómico.

Anterior: [Guía del Módulo 11](/guide/module-11)
