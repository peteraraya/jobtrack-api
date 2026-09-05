# Walkthrough — guion de demo (5–7 min)

> El guion de portafolio. Prensa **Stage** → **Play** → **Stand**: el objetivo es que el revisor vea un sistema _vivo_, no un slideshow. Los comandos están en el orden exacto que se probaron contra el stack real (Módulo 11).

## Setup (previo, no se graba)

- Stack ya levantado con un comando: `docker compose up -d --build` (4/4 healthy).
- Una terminal lista para `docker compose logs -f api`.
- Seed aplicado.

## La demo, minuto a minuto

### 0:00 — "El problema y la forma" (30 s, sin abrir el editor)

> "JobTrack ayuda a organizar la búsqueda de empleo. Es una API con pipeline de scraping: algo detecta ofertas afuera y las publica acá como dominio. Lo que vas a ver es el pipeline corriendo entre **dos procesos** que se hablan por Redis, con reintentos, breaker y el esquema controlado por migraciones."

Abrir el diagrama de arquitectura del README — no el código.

### 0:30 — El sistema vivo (60 s)

```bash
curl -s http://localhost:3000/health | jq
```

> "El health check responde **con estado real de la base**, no un `"ok"` fijo: si Postgres cae, esto cambia."

```bash
curl -s http://localhost:3000/v1/scraping/worker | jq
```

> "Este endpoint es la prueba del desacople: el API pregunta al proceso worker vía Redis transport y responde `status: up`. Son **dos procesos distintos** — si el worker está caído, el API sigue vivo."

### 1:30 — Auth con rotación real (60 s)

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@jobtrack.dev","password":"Admin1234!"}' | jq -r .accessToken)
curl -s http://localhost:3000/v1/auth/me -H "Authorization: Bearer $TOKEN" | jq
```

> "Access corto + refresh **con rotación**: cada uso invalida el anterior. Hay un e2e que demuestra el negativo — reutilizar el refresh robado da `401` y mata la sesión."

### 2:30 — RBAC y propiedad (60 s)

```bash
curl -s http://localhost:3000/v1/companies -H "Authorization: Bearer $TOKEN" | jq
curl -s 'http://localhost:3000/v1/job-offers?cursor=...' | jq
```

> "Empresas y ofertas: el admin escribe, el user lee. Postulaciones scoped por **propietario** — el guard no filtrua después, filtra antes, y el repositorio re-filtra por `userId` como segunda línea."

### 3:30 — El pipeline de scraping (60 s) — EL momento

```bash
curl -s -X POST http://localhost:3000/v1/scraping/ingest \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{}' | jq
docker compose logs -f worker | grep --line-buffered 'ingest'
```

> "El admin encola un _comando_; el worker lo consume con **reintento y backoff exponencial**, cada fuente con su own **circuit breaker**, y el upsert es idempotente por `sourceUrl` con `ON CONFLICT DO UPDATE`. Si cae una fuente, el resto no se contagia. Cuando el ingesta publicado, el API emite el **evento de dominio** y el WebSocket notifica al usuario que le matchea el stack."

> "Dato que se nota: si repetís el ingest, la cola lo **dedup** por `jobId` estable — los e2e lo prueban."

### 4:30 — Transacciones que aguantan la muerte (45 s)

```bash
# en otra terminal
npm run db:txn-demo -- run --marker demo-1
```

> "¿Qué pasa si el proceso muere a mitad de una transacción? No es teoría: este script abre una transacción real, crea filas, le manda `SIGTERM` al proceso… y después verifica contra Postgres que **nada quedó**: `client.release(true)` hacía el rollback aun en un kill."

### 5:15 — Cierre (45 s)

Abrir `.github/workflows/ci.yml` una línea:

> "Esto es la pirámide (87 unit, 5 integración, 52 e2e), después el gate de auditoría de producción (las vulns conocidas del dev tooling **no viajan** en la imagen), y el smoke que corre contra el **contenedor construido** — no contra `nest start`."

> "Lo más difícil del proyecto no fue 'agregar cosas': fue **decidir qué no agregar** — el micromonolito del Módulo 9 fue la decisión con más trade-off y está pensada para escalar sin reescribir contratos."

Listo. Fin.

## Preguntas que seguro hacen

| Pregunta                              | Dónde apuntar                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| "¿Por qué dos procesos y no un cron?" | War story #2 (colas + breaker) y #5 (micromonolito)                                     |
| "¿Cómo probás que no hay N+1?"        | War story #1 + contador de queries en integración                                       |
| "Si cae Postgres, ¿qué pasa?"         | Health real + retry de migraciones en `docker-entry.mjs`                                |
| "¿Refresh rotation seguro?"           | War story #3 + e2e del caso negativo                                                    |
| "¿Cómo despliegas?"                   | `docker compose up -d --build` + GH Actions: audit → build → smoke contra el contenedor |

Para la siguiente ronda — preguntas de arquitectura, rendimiento, seguridad y el "¿qué harías distinto?" de un líder técnico — pasá a la guía completa: [Preguntas de líder técnico](/guide/tech-lead-questions).

Anterior: [War stories](/guide/war-stories)
