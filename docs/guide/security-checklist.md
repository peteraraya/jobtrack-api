# Checklist de seguridad OWASP — JobTrack API

> Proceso de revisión documentado del **Módulo 10**. No persigue "cero hallazgos": persigue que cada categoría se haya repasado contra código real con su evidencia y su remediación (aplicada o planificada).

## Cobertura por categoría

### A01 — Broken Access Control ✅ aplicado

| Verificación                                            | Evidencia                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Endpoint protegidos por defecto (`JwtAuthGuard` global) | e2e: `GET /v1/auth/me` sin token → 401                      |
| RBAC por rol (`@Roles`, `RbacGuard`)                    | e2e: `POST /v1/companies` como `user` → 403                 |
| Ownership (cada recurso tiene dueño)                    | e2e: `PATCH /v1/applications/:id` de otro usuario → 404/403 |
| Mass assignment imposible (DTOs whitelist)              | unit: DTO valida/elimina campos extra (whitelist)           |
| Notificaciones leídas solo por su dueño                 | e2e M8: otro usuario no recibe el push ajeno                |

**Hallazgo**: ninguno. **Nota**: el sistema usa RBAC plano (`user`/`admin`); si creciera, migrar a ABAC/acceso por recurso (postgres policies) — documentado, no aplicado.

### A02 — Cryptographic Failures ✅ aplicado

| Verificación                                       | Evidencia                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| Passwords con bcrypt (nunca texto plano/«rápidos») | `PasswordService`, hash `bcrypt`                                       |
| Tokens 2xB, expiración corta + rotación            | `accessToken` 15m / `refreshToken` rotado y revocado (Módulo 4)        |
| No se logean secretos ni tokens                    | ningún logger imprime headers de auth; auditado en observabilidad (M5) |
| Transporte solo HTTP(S)                            | helmet `Strict-Transport-Security` presente (e2e M10)                  |

**Hallazgo**: ninguno crítico. **Nota**: JWT firma HS256 (simétrico) — adecuado para un solo servicio; documentado pasar a RS256 si hubiera varios agentes firmando.

### A03 — Injection ✅ aplicado

| Verificación                                                                                    | Evidencia                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Queries paramétricas (TypeORM query builder / Repository, sin `query()` con string interpolado) | revisión de código; no existe interpolación en SQL            |
| Validación de entrada con class-validator + whitelist + forbidNonWhitelisted                    | DTOs de todos los módulos (M2)                                |
| `ORDER BY`/cursors con allowlist de columnas                                                    | `CursorPagination` valida campo/orden contra allowlist (unit) |

**Hallazgo**: ninguno. La clase de riesgo (inyección) no tiene superficie: toda entrada pasa por DTO y toda query es paramétrica.

### A04 — Insecure Design ✅ revisado

| Verificación                                            | Estado                                            |
| ------------------------------------------------------- | ------------------------------------------------- |
| Throttling sobre login/registro (brute force)           | aplicado M4 (rate limit)                          |
| Reintentos con backoff exponencial y breaker por fuente | aplicado M7/M9 (no se abusa de la fuente externa) |
| Semáforo/jobId estable contra doble-encolado            | aplicado (dedup BullMQ)                           |
| Transacciones atómicas ante muerte del proceso          | demostrado M10 (`db:txn-demo`)                    |

### A05 — Security Misconfiguration ✅ aplicado

| Verificación                            | Evidencia                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Headers de seguridad (helmet)           | e2e M10: CSP, frame, nosniff, HSTS, referrer, CORP, origin-agent-cluster, sin `X-Powered-By` |
| Sin endpoints de debug/trivia expuestos | onboarding limpio; cron/breakers solo vía admin RBAC                                         |
| `synchronize` apagado en prod           | `PostgresModule` desactiva en `NODE_ENV=production` (revisión M3)                            |
| CORS acotado, no `*`                    | configuración CORS documentada en proceso de deploy (M11)                                    |

**Hallazgo**: ninguno. **Nota env `true`**: si `mail:true` de Nodemailer/verboso llegara a prod, se apaga con la config de entorno — documentado.

### A06/A07 — Vulnerable/Outdated Components ⚠️ documentado

| Verificación    | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit`     | 8 hallazgos (2 low, 3 moderate, 3 high) — **todos** encadenados a tooling de desarrollo: `@nestjs/mau` (CLI, arrastra `inquirer`/`tmp`/`undici`) y `vitepress` (dev server `esbuild`/`vite`). Ninguna dependencia de **runtime** (`@nestjs/*` core, bullmq, typeorm, helm…) tiene advisory directo. `npm audit fix --force` "resuelve" instalando `@nestjs/mau@0.0.6`, un breaking change que rompe el CLI de Nest: se rechaza y se espera el fix upstream |
| `npm outdated`  | paquetes al día salvo nest/typeorm/vitepress con minor disponibles                                                                                                                                                                                                                                                                                                                                                                                         |
| Dependabot/Snyk | **`.`github/dependabot.yml` activo** (npm semanal + actions mensual); Snyk opcional sobre el mismo resultado                                                                                                                                                                                                                                                                                                                                               |

**Remediación**: los hallazgos están en tooling de desarrollo, no en el código desplegado. El CI (job `audit`) **falla** si aparece severidad alta **en runtime**; las excepciones documentadas para `@nestjs/mau`/`vitepress` se revisan en cada actualización (Dependabot las trae como PRs que pasan por el mismo gate). Además el Dockerfile poda devDependencies (`npm prune --omit=dev`): ese tooling ni siquiera entra a la imagen.

### A08 — Software and Data Integrity Failures ✅ aplicado

| Verificación                                               | Estado                                          |
| ---------------------------------------------------------- | ----------------------------------------------- |
| `package-lock.json` versionado (reproducibilidad)          | sí                                              |
| `npm ci` con lockfile en CI (nunca `npm install`)          | sí — `.github/workflows/ci.yml`                 |
| `npm audit` de dependencias de **runtime** como gate en CI | sí — job `audit` (falla en high+ de producción) |
| `engines` fijados                                          | sí (node >= 20)                                 |
| Sin dependencias instaladas por URL mutable                | sí, todo por semver                             |

### A09 — Logging and Monitoring ✅ aplicado (M5) + chequeo

| Verificación                                   | Evidencia                                      |
| ---------------------------------------------- | ---------------------------------------------- |
| `request-scoped` con `requestId` end-to-end    | interceptor + `REQUEST_ID_HEADER` (e2e M5)     |
| Request log con método, ruta, status, duración | interceptor                                    |
| `GET /health` para probes                      | excluida del prefijo `/v1` de forma deliberada |

**Chequeo**: ninguna credencial en logs (no se imprime el body ni headers de auth).

### A10 — SSRF ✅ aplicado (Módulo 9)

El único lugar que toca URLs externas es el worker de scraping:

| Verificación                                                            | Estado                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| Fuentes en allowlist cerrada (`sources` de config, no input de usuario) | sí — `POST /v1/scraping/ingest` no acepta URLs |
| Timeout y breaker por fuente (no hay fetch indefinido)                  | sí                                             |
| El API nunca hace fetch a destinos arbitrarios                          | sí — `fetchSource` vive en el worker           |

**Hallazgo**: el único sitio con fetch externo no acepta URLs de usuario: SSRF no tiene superficie.

### Extras revisados

- **Rate limit sobre login** ya cubierto (A04). No hay **upload de archivos** → sin superficie para path traversal de archivos. No hay **XML** → XXE no aplica. No hay **manejo de pago** → PCI fuera de alcance.

## Cómo se mantiene

1. Cada módulo nuevo pasa un dif contra este checklist antes de marcar "completo".
2. `npm audit` corre en el CI del Módulo 11 con fallo en severidad alta.
3. Dependabot/Snyk + renovación manual mensual de dependencias.

Anterior: [Guía del Módulo 10](/guide/module-10)
