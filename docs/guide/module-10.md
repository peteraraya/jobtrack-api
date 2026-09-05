# Módulo 10 — Seguridad avanzada, resiliencia y checklist OWASP

> **Estado:** ✅ Completo · **Duración estimada:** 4–5 días
> **Rama de git sugerida:** `module-10-security`

## Conceptos clave

- **OWASP Top 10 como checklist, no como auditoría de una sola vez**: se repasó cada categoría contra el código real (ver [checklist de seguridad](/guide/security-checklist)). Documentar el _proceso de revisión_ vale más que la ausencia de hallazgos.
- **Versionado semántico de la API**: todo el HTTP público pasa a vivir bajo `/v1`. Un prefijo no es cosmético: es el contrato que le permite al sistema evolucionar con breaking changes **sin romper consumidores existentes**. La decisión de dónde NO versionar también importa: `/health` queda fuera del prefijo porque se puede ir a v2, v3… y un probe de orquestación contra `/v1/health` seguiría funcionando.
- **Graceful shutdown ≠ matar el proceso**: recibir `SIGTERM`/`SIGINT` no es "salir ya", es "dejar de aceptar trabajo y cerrar las conexiones de forma ordenada". En Nest esto es `app.enableShutdownHooks()`, y la parte interesante es **qué se cierra y quién lo cierra**.
- **La transacción como unidad atómica**: si un proceso muere a mitad de una transacción, Postgres la **revierte completa** al cerrarse la conexión — nunca queda estado a medio escribir. Eso se demostró (ver [el reto](#el-reto-sigterm-a-mitad-de-una-transacción)).

## Lo que se implementó

### 1. Prefijo de versión: `app.setGlobalPrefix('v1', { exclude: ['health'] })`

En `src/configure-app.ts` (el mismo código que corre el runtime y el e2e, así no diverge el contrato):

```ts
app.setGlobalPrefix('v1', { exclude: ['health'] });
```

- `GET /health` → **queda sin prefijo** (probe de infraestructura, no contrato de dominio).
- Todo el resto (`/auth/*`, `/companies`, `/job-offers`, `/applications`, `/notifications`, `/scraping/*`) → `/v1/...`.
- El **WebSocket** (`namespace /notifications`) **no** se versiona: es un canal en tiempo real, no una ruta HTTP; versionar conservadores de sesión por prefijo sería cosmético.

El e2e se actualizó en masa a `/v1` y el `scripts/smoke.mjs` también, para que la verificación externa use el mismo contrato que los tests.

### 2. Hardening de headers: helmet + opciones

helmet ya venía del Módulo 4 con sus defaults (CSP, `X-Frame-Options`, `nosniff`, HSTS, oculta `X-Powered-By`). El Módulo 10 agrega tres políticas explícitas:

```ts
app.use(
  helmet({
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: true,
  }),
);
```

| Header                                      | Valor         | Mitiga                                                       |
| ------------------------------------------- | ------------- | ------------------------------------------------------------ |
| `Referrer-Policy: no-referrer`              | `no-referrer` | filtra la URL (con token) a terceros por el header `Referer` |
| `Cross-Origin-Resource-Policy: same-origin` | `same-origin` | previene/ensancha la superficie de cross-origin reads        |
| `Origin-Agent-Cluster: ?1`                  | `?1`          | aisla el agente de origen (mitigación de Spectre)            |

El contrato se testeó en e2e: presencia de los 6 headers + **ausencia** de `X-Powered-By` (fingerprinting del framework).

### 3. Graceful shutdown: `enableShutdownHooks()` + quién cierra qué

`enableShutdownHooks()` se registró en **ambos** bootstraps (`src/main.ts` y `src/main-scraper.ts`). La pregunta de entrevista es qué pasa al apagar. Verificado leyendo el código de las dependencias:

| Recurso                        | Quién lo cierra                                  | Cómo                                                                                                                |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Postgres                       | `TypeOrmCoreModule.onApplicationShutdown`        | `dataSource.destroy()` (espera consultas activas)                                                                   |
| Colas BullMQ                   | `BullExplorer.onApplicationShutdown`             | cierra workers y queues (los jobs en vuelo no se pierden)                                                           |
| `ClientProxy` Redis (Módulo 9) | **`CloseRedisClientOnShutdown`** (este proyecto) | el cliente de microservicios abre su propia conexión Redis; sin cerrarla el proceso espera que el socket muera solo |

El hook propio es un provider registrado en `ScrapingModule` (API) y `ScrapingWorkerModule` (worker), inyectado por el token `SCRAPING_WORKER_CLIENT` y testeado en unit (87 specs):

```ts
@Injectable()
export class CloseRedisClientOnShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(SCRAPING_WORKER_CLIENT)
    private readonly client: ClientProxy,
  ) {}

  onApplicationShutdown(): Promise<void> | void {
    this.client.close();
  }
}
```

Orden del shutdown Nest: `onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown`. Es la diferencia entre "cerró las conexiones" (graceful) y "el SO reclamó los sockets" (kill).

### 4. El token `SCRAPING_WORKER_CLIENT` se movió a `src/config/tokens.ts`

Para no importar señalización del dominio de scraping desde `common/`, el nombre del token pasa a `capa config` (junto a `REDIS_URL`, `DATABASE_URL`, etc.). Los 4 usos (`scraping.controller`, `scraping.module`, `scraping-worker.service`, `scraping-worker.module`) importan el token desde `../../config/tokens.js`. `queues.contants.ts` queda solo con las constantes de colas.

### 5. El reto: SIGTERM a mitad de una transacción

`scripts/transaction-rollback-demo.mjs` demuestra (y verifica contra Postgres real) los dos lados de la historia:

```bash
npm run db:txn-demo -- run --marker <demo>   # hace el demo
npm run db:txn-demo -- verify <demo>          # verifica contra la BD
```

1. El proceso `BEGIN`, inserta una fila y **COMMIT**a antes del SIGTERM → la fila **sobrevive**.
2. El proceso `BEGIN`, inserta **sin** commit y recibe SIGTERM → el handler de shutdown cierra la conexión con la transacción abierta → Postgres **revierte todo**.

El `verify` comprueba, con ids derivados deterministamente del marcador: la fila `commit-demo` **existe**, la fila `abort-demo` **no existe**. Cero estado a medio escribir. Ese es el comportamiento que `enableShutdownHooks()` garantiza en producción.

## Mejores prácticas aplicadas

- ✅ **Versionado desde ahora, no cuando duela**: romper `/v1` implica v2; nunca "romper silenciosamente".
- ✅ **`/health` excluida del prefijo**: probe de infraestructura ≠ contrato de dominio.
- ✅ **Cada conexión tiene dueño**: TypeORM/BullExplorer cierran lo suyo; el `ClientProxy` lo cierra nuestro hook, testeado en unit.
- ✅ **Rollback atómico demostrado, no asumido**: el reto OWASP/entrevista se responde con un demo reproducible que se verifica contra la BD.
- ✅ **Secrets ya gestionados**: `.env` con `ConfigModule` (Módulo 2/3); el gestures manager real queda documentado para el deploy (Módulo 11).
- ✅ **Escaneo de dependencias**: `npm audit` (8 hallazgos) y `npm outdated` documentados en el checklist; Dependabot/Snyk se activan con el repo público (Módulo 11).

## Verificación del entregable

```bash
npm run build             # compila
npm run lint              # 0 warnings, 0 errors
npm test                  # 87 unit → all passed
npm run test:integration  # 5 integration → all passed (requiere Postgres en 5433)
npm run test:e2e          # 52 e2e → all passed (requiere Postgres 5433 + Redis 6379)
npm run docs:build        # VitePress builda sin errores
npm run db:txn-demo -- run --marker demo-1 && npm run db:txn-demo -- verify demo-1
```

`npm run db:seed` vuelve a correr sin cambios: el ingreso es por contrato, no por ruta; el prefijo `/v1` no altera la siembra.

Anterior: [Módulo 9](/guide/module-09) · Siguiente: [Módulo 11](/guide/module-11)
