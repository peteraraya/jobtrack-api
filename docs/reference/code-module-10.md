# Código fuente — Módulo 10

Código real del proyecto al cierre del Módulo 10: API versionada (`/v1`), headers de seguridad hardened, graceful shutdown con cierre ordenado de la conexión Redis del transport, y el demo verificable de rollback ante `SIGTERM` a mitad de una transacción.

## `src/configure-app.ts` — pipeline HTTP compartido (runtime = e2e)

```ts
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { TrimPipe } from './common/pipes/trim.pipe.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';

export function configureApp(app: NestExpressApplication): void {
  // Módulo 10 — versionado semántico de la API desde ahora: todo contrato de
  // negocio vive bajo /v1 (envuelto, con headers de seguridad). La infra
  // (health) queda SIN prefijo: es un endpoint de orquestación, no de dominio.
  app.setGlobalPrefix('v1', { exclude: ['health'] });

  // Seguridad de headers (Módulo 4 + Módulo 10): además de los defaults de
  // helmet (X-Frame-Options, nosniff, CSP, oculta X-Powered-By) agregamos:
  // referrer-policy, cross-origin-resource-policy y origin-agent-cluster.
  app.use(
    helmet({
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      originAgentCluster: true,
    }),
  );

  // CORS explícito por whitelist de orígenes (nunca '*' en producción).
  const configService = app.get(ConfigService);
  const origins = String(configService.get('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : true });

  // Orden de pipes: trim (normalización) ANTES de validación.
  app.useGlobalPipes(new TrimPipe(), new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useBodyParser('json', { limit: '1mb' });
}
```

## `src/main.ts` — shutdown hooks + transporte (API)

```ts
// Módulo 10 — graceful shutdown: SIGTERM/SIGINT → onApplicationShutdown de
// cada provider. El core cierra Postgres (TypeOrmCoreModule), los workers y
// colas BullMQ (BullExplorer) y los clientes Redis que registramos en los
// módulos de scraping.
app.enableShutdownHooks();
```

## `src/main-scraper.ts` — shutdown hooks (worker)

El worker también registra `app.enableShutdownHooks()`: su `CloseRedisClientOnShutdown` cierra el publicador Redis que emite `job-offer.created`.

## `src/common/lifecycle/close-redis-client-on-shutdown.ts` — el cierre que el core no hace

```ts
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { SCRAPING_WORKER_CLIENT } from '../../config/tokens.js';

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

Registrado como provider en `ScrapingModule` (API) y `ScrapingWorkerModule` (worker). El core de Nest cierra Postgres (`TypeOrmCoreModule.onApplicationShutdown` → `dataSource.destroy()`) y las colas (`BullExplorer.onApplicationShutdown`); el `ClientProxy` de microservicios abre **su propia** conexión Redis y sin este hook el proceso esperaría que el socket muriera solo.

## `src/config/tokens.ts` — el token vive en la capa config

```ts
/**
 * Tokens de infraestructura compartida. Viven en config/ (infra común) para
 * que common/, config/ y modules/ dependan del MISMO símbolo sin ciclos —
 * ej. un lifecycle hook de common cierra el cliente Redis sin importar un
 * token definido dentro de modules/scraping.
 */

/**
 * Módulo 9+10 — token del ClientProxy hacia el microservicio worker.
 * El API lo inyecta para invocar request-response (`scraping.ping`) y
 * comandos (`scraping.ingest`) sobre Redis transport; el worker lo usa para
 * PUBLICAR el evento `job-offer.created`. El lifecycle hook de cierre lo
 * referencia desde acá (shutdown ordenado).
 */
export const SCRAPING_WORKER_CLIENT = 'SCRAPING_WORKER_CLIENT' as const;
```

`scraping.controller.ts`, `scraping.module.ts`, `scraping-worker.service.ts` y `scraping-worker.module.ts` importan el token desde `../../config/tokens.js`; `queues.contants.ts` queda solo con las constantes de colas.

## E2E — contrato de headers de seguridad

```ts
it('seguridad: headers de helmet hardening + sin X-Powered-By (Módulo 10)', async () => {
  const res = await http().get('/v1/companies').expect(200);

  expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-security-policy']).toBeDefined();
  expect(res.headers['strict-transport-security']).toBeDefined();

  expect(res.headers['referrer-policy']).toBe('no-referrer');
  expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(res.headers['origin-agent-cluster']).toBe('?1');

  expect(res.headers['x-powered-by']).toBeUndefined();
});
```

## `scripts/transaction-rollback-demo.mjs` — el reto: SIGTERM a mitad de una transacción

```bash
npm run db:txn-demo -- run --marker demo-1
npm run db:txn-demo -- verify demo-1
```

Esqueleto (lo esencial): el proceso abre una conexión, hace `BEGIN` + `INSERT` + `COMMIT` (filas que deben sobrevivir) y luego `BEGIN` + `INSERT` **sin** commit; dispara `process.kill(process.pid, 'SIGTERM')` y el handler de shutdown cierra la conexión (`client.release(true)` → Postgres revierte):

```js
process.on('SIGTERM', () => {
  console.log('[shutdown] cerrando conexión con la transacción abierta...');
  client.release(true); // cierra la conexión → Postgres revierte la tx
  void pool.end().then(() => {
    process.exit(0);
  });
});
process.kill(process.pid, 'SIGTERM');
```

El `verify` consulta ids **derivados determinísticamente del marcador** (función `deriveUuid(seed)` con sha1 → uuid) para que un proceso nuevo compruebe los mismos registros:

```text
commit-demo (COMMIT antes del SIGTERM): persistida ✓
abort-demo (tx abierta al SIGTERM):   revertida ✓ (no quedó estado a medio escribir)
Rollback atómico de PostgreSQL verificado ✅
```

Anterior: [Código fuente (módulo 9)](/reference/code-module-9)
