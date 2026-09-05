# Preguntas de líder técnico (y cómo responderlas con este repo)

> Un líder técnico no pregunta para que recites definiciones — pregunta para **ver qué pasa cuando no sabés**: cómo estructurás, qué trade-offs reconocés y si lo que decís está o no en tu repo. Esta guía ordena las preguntas que te van a hacer, qué busca el líder con cada una, y la respuesta que **podés sostener con archivos reales** de JobTrack.

## Cinco reglas para responder como senior

1. **Nunca digas "lo leí"** — decí "acá lo hice" y señalá el archivo.
2. **Respuesta en tres tiempos**: qué hice → por qué (trade-off) → qué haría distinto.
3. **El "no sé" se contesta con método**: "no lo medí, pero lo mediría así".
4. **Siempre traé un momento**: una war story (bug/N+1), una decisión (micromonolito) o una prueba (db:txn-demo).
5. **El repo es tu argumento**: si algo no está, acéptalo — el líder lo va a notar y tu honestidad vale puntos.

---

## 1. Arquitectura y diseño

### "¿Por qué NestJS y no Express pelado o Fastify?"

**Qué busca:** que sepas lo que un framework te compra y lo que te esconde.

**Respuesta:** Nest te da **contratos estándar** para lo que Express deja a criterio: DI y scopes de providers, guards/interceptors/pipes con **orden de ejecución definido**, y una estructura por feature. Con Express, la "arquitectura del proyecto" es personal de cada autor; con Nest, un equipo nuevo entra a un proyecto y ya sabe dónde vive cada cosa. El trade-off es que hay _magia_ (decorators, metadata): cuando algo falla, tenés que entender el framework, no solo tu código.

### "¿Cuándo usarías microservicios de verdad? Y este proyecto, ¿por qué no?"

**Qué busca:** que no repitas el mantra "microservicios = bueno".

**Respuesta:** [war story #5](/guide/war-stories): separé el worker como **proceso independiente** porque tenía un contrat "obvio" — el scraping (fetch + breaker + upsert) no necesita el ciclo request/response del API. Pero es un **micromonolito en una máquina**: mismo deploy, mismo repo, sin malla de servicio. Elegí esto por tres razones: el equipo es chico, la operación sigue siendo simple, y el costo real de microservicios (latencia de red, versionado de contratos, debugg distribuido) no se paga con esta carga. La decisión está diseñada para escalar **sin reescribir contratos** — el contrato es el evento `job-offer.created`, no el dominio interno.

Considerá microservicios de verdad cuando: equipos autónomos por dominio, volúmenes que exigen escala independiente, contratos estables. Ninguno aplica acá todavía.

### "Comando vs evento: tu scraping parece usar los dos. ¿Por qué?"

**Qué busca:** que distingas _quién pide_ vs _quién se entera_.

**Respuesta:** son dos semánticas:

- **Comando** (cola BullMQ `ingest`): "hacé este trabajo" → necesita reintentos, backoff, dedup por `jobId`. El admin lo dispara y espera un resultado (request-response `scraping.ingest` con timeout 3s).
- **Evento** (`job-offer.created` publicado por Redis transport): "esto PASÓ" → fire-and-forget, nadie responde, el API reacciona (encola su cola `notify` local). El worker no conoce notificaciones; el API no conoce fuentes.

Si publicara el evento en vez del comando, el trabajo quedaría sin dueño (nadie lo reintenta). Si pidiera como comando que "notifiquen a alguien", acoplaría al API con el pipeline de scraping. Cada canal resuelve una pregunta distinta.

### "¿Cómo escalarías el worker? ¿Y el API?"

**Qué busca:** que sepas dónde está el cuello y qué hace seguro la réplica.

**Respuesta:** el worker sube réplicas del proceso `main-scraper` — BullMQ reparte jobs entre consumidores sin lógica extra, y la **idempotencia** (`ON CONFLICT DO UPDATE` por `sourceUrl`, `jobId` estable) hace seguro el reproceso. El API escala igual (réplicas del proceso API): las colas `notify` y `ingest` viven en Redis, así que el estado no queda en memoria de un pod. Limite real: el esquema y Postgres — ahí escalaría lectura con réplicas de lectura antes que cache por moda.

### "¿Cómo evoluciona el schema sin downtime?"

**Respuesta:** con **migraciones versionadas** (`synchronize: false` en prod). El patrón es _expand-migrate-contract_: agregar columna (nullable) → hacer el backfill → declararla NOT NULL/única en otra migración. El `docker-entry.mjs` corre las migraciones con retry idempotente al arrancar cada contenedor, así el deploy aplica el schema sin paso manual.

---

## 2. Rendimiento y datos

### "¿Cómo sabés que no tenés N+1? ¿Mostrame."

**Qué busca:** que la optimización no sea anecdotal.

**Respuesta:** [war story #1](/guide/war-stories) + dos evidencias en el repo: el demo `npm run db:n1` compara naive vs joins contando queries reales, y el test de integración usa un **contador de queries** que falla si el endpoint vuelve a hacer más de una query. El endpoint es `find({ relations: { jobOffer: { company: true } } })` en `typeorm-applications.repository.ts:99`.

### "Dos postulaciones concurrentes al mismo cupo. ¿Cómo evitás sobre-vender?"

**Qué busca:** consistencia real, no "lo manejaría con un lock".

**Respuesta:** `createWithSlotDecrement` (mismo archivo) usa una transacción con **UPDATE condicional atómico**: `UPDATE ... SET slots = slots - 1 WHERE id = :id AND slots > 0`. Si afecta 0 filas, o no existe la oferta (404) o no quedan cupos (409). Elegí el UPDATE condicional sobre `SELECT ... FOR UPDATE` porque la fila queda bloqueada por el propio UPDATE — si la carrera la dispara la UNIQUE de la DB, se traduce a 409 `DuplicateApplication` y no a un 500. El test de integración lo cubre con hilos reales apuntando al mismo cupo.

### "¿Qué índices pondrías en esta base?"

**Respuesta:** las consultas de listing son `applications WHERE user_id` (orden por `created_at DESC` → índice compuesto `(user_id, created_at)`), y el scraping exige unicidad en `source_url` (ya está, es lo que hace el `ON CONFLICT`). El refresco de auth busca por `user_id` en el hash de refresh. Con datos chicos no se nota; el índice se agrega en una migración cuando la medición (pg_stat_statements) lo pida — **no antes**.

### "¿Y cache? ¿Por qué no cacheaste nada?"

**Respuesta defensa honesta:** por diseño. No hay cache porque no hay medición que la exija: las lecturas son por usuario y la cardinalidad es baja. Meter Redis cache "porque sí" agrega invalidation complexity y lecturas eventualmente consistentes en un dominio donde el cambio de estado importa (postular consumiendo cupo). La pieza que SÍ escala es el índice + réplicas de lectura. Un líder técnico valora más quien no agrega infra de la que valida quien la agrega.

---

## 3. Seguridad

### "¿Cómo funciona tu refresh rotation? ¿Qué pasa si te roban el token?"

**Qué busca:** que entiendas la diferencia entre firmar bien y _diseñar para la amenaza_.

**Respuesta:** [war story #3](/guide/war-stories): el refresh vive en DB **solo como hash**, y cada uso **rota**: el refresh recibido queda invalidado y se emite un par nuevo. Si un atacante roba el refresh: o bien lo usa primero (roba la sesión, pero el usuario al siguiente uso la revoca y el e2e prueba que el token viejo da `401`), o bien el usuario lo usa primero y el token del atacante es inútil. La rotación convierte el robo en una **carrera que el diseño gana por defecto**.

### "¿Qué controlás del OWASP? ¿Elegí una categoría y explicá."

**Respuesta:** el [checklist](/guide/security-checklist) cubre A01–A10 con evidencia: A01/A07 (auth): JWT+refresh rotation+RBAC; A04 (diseño inseguro): `synchronize:false` + migraciones; A05 (config insegura): `helmet` hardening + `guid` → `v1`, secrets nunca en el repo; A10 (SSRF, en scraping): el único fetch externo vive en el worker contra una **allowlist de fuentes de config** — `POST /v1/scraping/ingest` nunca acepta URLs de usuario, entonces SSRF no tiene superficie; A06/A08: audit + Dependabot, imagen sin devDependencies. Elegí una y desarrollá — el abanico demuestra que lo pensaste como categoría, no como checklist de un blog.

### "¿Cómo evitás que me brute-forceen el login?"

**Respuesta:** `ThrottlerModule` global + `@Throttle` más estrecho en `register`/`login` (`AUTH_THROTTLE_TTL`/`AUTH_THROTTLE_LIMIT`). Fuera del alcance está lo de siempre: exponer `login` tras un CF/rate-limit de borde y monitorear el patrón de intentos.

### "¿Y si Redis cae?"

**Respuesta con capas:** (1) qué no cae: el API sigue sirviendo REST si la DB responde; (2) las colas persisten en Redis — si cae, el trabajo queda esperando, no se pierde (BullMQ mantiene el estado que Redis tenía); (3) el health `/health` es real y reporta DB; Redis no está en el health pero el request-response `scraping.ping` con timeout hace que el admin **sepa** que el worker está inalcanzable sin colgarse. Migraciones con retry cubren el arranque si Postgres arranca más lento.

---

## 4. Testing y calidad

### "Tu pirámide: 87 unit / 5 integración / 52 e2e. ¿Por qué tan pocos de integración?"

**Respuesta honesta (la mejor):** la integración acá no cubre el 80% porque la **lógica de dominio está en los services, testeada en unit** con fakes; la integración cubre **lo que toca el driver real**: `typeorm-applications.repository` con concurrencia real (cupo), contador de queries (N+1) y el repositorio contra Postgres de verdad. Los e2e cubren el contrato HTTP completo. Si un líder te pregunta "¿y acá dónde está el riesgo?", la respuesta correcta es: el riesgo está en el driver, y ahí están los 5 tests de integración.

### "¿Cómo corren tus tests contra una base real sin ensuciarla?"

**Respuesta:** cada e2e dropea el schema y lo recrea (`synchronize: true` solo en tests) y purga las colas (`obliterate`) — la suite es **estadísticamente reproducible**, corre en cualquier máquina y en CI. En producción el schema lo gobiernan las migraciones (`synchronize: false`). Esta es también la war story #4: mezclar ambos mundos (schema "casi igual" sin historial de migraciones) fue el bug del volumen del compose. Por eso el CI levanta el stack completo y corre el smoke contra el **contenedor real**.

### "¿Podrías enviar un PR que rompa algo sin que el CI lo note?"

**Respuesta:** sí, y lo sé: el CI no gatea coverage, no corre lint, y el smoke valida endpoints pero no esquema. El gate completo (lint+build+unit+integration+e2e) está detallado en `ci.yml` como TODO. Acá la honestidad suma: "hay agujeros, acá están, así cerraría el primero".

---

## 5. Operación y despliegue

### "¿Cómo sabés que lo que está en producción es lo mismo que testeas?"

**Respuesta:** el job `smoke-containers` del CI construye la **imagen real**, levanta el compose, siembra y corre `scripts/smoke.mjs` contra el contenedor — no contra `nest start`, no contra un mock de Docker. Lo que firma el smoke es el mismo artefacto que sale a producción.

### "¿Y si hay que revertir una migración?"

**Respuesta:** las migraciones son archivos versionados con `down()`; por eso tienen que ser **reversibles y separadas** (add column / backfill / constraint). En la práctica: migrar hacia adelante siempre que se pueda, revertir solo en emergencia y **nunca** con datos destructivos sin plan de recuperación.

### "Contame del rollback ante SIGTERM."

**Respuesta:** [walkthrough](/guide/walkthrough) minuto 4:30 — `npm run db:txn-demo` abre una transacción real, crea filas, mata el proceso con `SIGTERM` en el medio, y un proceso nuevo verifica contra Postgres que **nada quedó**. Es el `enableShutdownHooks` del Módulo 10 + el release de la conexión con rollback. No es teoría: es un script verificable en tu máquina.

---

## 6. El proyecto (que no se prepare — se conoce)

### "¿Qué fue lo más difícil? / Contame un bug duro."

**Respuesta:** [war stories](/guide/war-stories), cronología de batalla: el N+1 que "andaba" (medición), el cambio de rumbo cron→colas (diseño), el refresh rotation (seguridad), y el mejor plot twist: el **bug del volumen** del Módulo 11 — el despliegue casi se cae porque el esquema "casi existía" sin historial de migraciones. Eso es oro: muestra falla real, diagnóstico y la lección.

### "¿Qué harías distinto si lo arrancaras hoy?"

**Respuestas honestas y concretas:**

- Migraciones desde el **módulo 3**, no después — la war story del volumen es su consecuencia.
- Un contrato de evento con **versionado de esquema del payload** desde el día uno del worker (`job-offer.created:v1`).
- Gate completo de CI (lint + coverage) **antes** del Módulo 11, no al final.
- Arrancar con un único pool de colas (cola `ingest` + `notify` unificados por dominio) — el split se decidiría igual, pero se verificaría más temprano.

### "¿Es solo un CRUD con colas?"

**Respuesta:** mostrá la profundidad real, no la enumerés: (1) contrato de dominio separado del transporte, (2) decisión M9 con trade-off pensado, (3) seguridad con threat model (rotación, SSRF del scraper), (4) testing que cuida **permutaciones** (concurrencia, N+1, rotación), (5) despliegue que prueba el artefacto. Un CRUD no tiene un demo de rollback transaccional ni una decisión arquitectónica que sea una postura.

---

## Las tres preguntas que "seguro" hacen (y el guion de 60 s)

| Pregunta                                  | Guion (respuesta = war story o archivo)                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| "Contame un bug difícil"                  | War story #1: N+1 → contador de queries → `db:n1`                             |
| "¿Por qué microservicios (o no)?"         | Decisión M9: contrato limpio, micromonolito honesto, escalable sin reescribir |
| "¿Qué pasa si el proceso muere a mitad…?" | `SIGTERM` + migraciones con retry + smoke del contenedor                      |

Anterior: [Walkthrough](/guide/walkthrough) · [War stories](/guide/war-stories)
