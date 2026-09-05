# Módulo 5 — Interceptors, middleware y observabilidad

> **Estado:** ✅ Completo · **Duración estimada:** 5–6 días
> **Rama de git sugerida:** `module-05-observability`

## Conceptos clave

- **Middleware** (nivel Express, antes del enrutamiento) vs. **Interceptors** (nivel Nest, envuelven la ejecución del handler con lógica pre/post vía `rxjs`).
- **Correlation ID**: el request fluye por todo el sistema con un `x-request-id`, visible en cada log de ese request.
- Logging **estructurado (JSON)**: nunca `console.log` suelto.
- Interceptor para **transformar la respuesta** (contrato `{ data, meta }` consistente) y para **medir duración** de cada request.
- `AsyncLocalStorage` (`node:async_hooks`): el requestId se propaga sin pasarlo como parámetro por todo el árbol de llamadas.

## Lo que se implementó

### 1. `AsyncLocalStorage` como "contexto de request"

El middleware abre un contexto (`requestContext.run({ requestId }, ...)`) que envuelve TODO lo que corra dentro del request. Cualquier capa — guard, interceptor, pipe, handler, filter — lee el `requestId` con `getRequestId()`. Sin esto habría que hilar el id a mano por constructor en cada service.

```ts
// src/common/observability/request-context.ts
export const requestContext = new AsyncLocalStorage<RequestContext>();
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
```

### 2. `RequestIdMiddleware`

Middleware de clase registrado con `consumer.apply(...).forRoutes('*')` en `AppModule`. Respeta el `x-request-id` entrante (para que un gateway/AWS ALB propague el id original) o genera un UUID. Setea el **header de respuesta** siempre:

```ts
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming?.trim().length > 0 ? incoming.trim() : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestContext.run({ requestId }, () => next());
  }
}
```

### 3. `LoggingInterceptor` — una línea JSON por request

Mide y loggea `requestId, method, path, statusCode, durationMs` en una línea JSON. La duración toma `performance.now()` ANTES de `next.handle()` y en `tap.next`/`tap.error` escribe el resultado. Se **silencia en e2e** (`NODE_ENV=test`, campo `enabled`) para no ensuciar la salida de vitest — la medición corre igual.

```ts
return next.handle().pipe(
  tap({
    next: () => this.write({ req, res, statusCode: res.statusCode, start }),
    error: (error) => {
      const statusCode =
        error instanceof HttpException
          ? error.getStatus()
          : res.statusCode >= 400
            ? res.statusCode
            : 500;
      this.write({ req, res, statusCode, start, error: true });
    },
  }),
);
```

> **Nunca se loguean passwords, tokens completos ni PII.** El interceptor solo loguea metadata del request.

### 4. `TransformResponseInterceptor` — contrato `{ data, meta }`

Toda respuesta **exitosa** se envuelve:

```json
{
  "data": { "id": "...", "email": "demo@jobtrack.dev" },
  "meta": { "timestamp": "2026-09-04T20:00:00.000Z", "requestId": "..." }
}
```

Reglas del contrato:

- Los **errores NO se envuelven** (los produce `AllExceptionsFilter`, que corre fuera de la cadena de interceptors). Un cliente distingue éxito de error por status + forma.
- `undefined` se coerciana a `null` para mantener la forma estable.
- Los `StreamableFile` se devuelven tal cual (no se envuelven).

Este cambio obligó a actualizar **todos** los e2e y el smoke a leer `body.data`, y es lo primero que debe saberse al consumir la API en el Módulo 5+.

### 5. Ejecución real: Middleware → Guard → Interceptor (pre) → Pipe → Handler → Interceptor (post) → Filter

Los interceptors globales se registran por `APP_INTERCEPTOR` (logging primero, transform segundo). Con una excepción en el handler, la secuencia es:

```
RequestIdMiddleware → Guards (Jwt → Throttler → Roles) → LoggingInterceptor.pre
→ TransformResponseInterceptor.pre → Pipes → Handler
→ TransformResponseInterceptor.post (envuelve { data, meta })
→ LoggingInterceptor.post (log de duración + status)
Y si algo lanzó: AllExceptionsFilter → respuesta de error sin envolver.
```

**Reto tipo entrevista resuelto:** ¿Guard o Interceptor para validar permisos? Guard — el interceptor **no se ejecuta** si un guard anterior falla, y los interceptores existen para transformar/medir, no para autorizar.

## Mejores prácticas aplicadas

- ✅ Correlation id propagado con `AsyncLocalStorage` (sin acoplar firmas).
- ✅ Header `x-request-id` en toda respuesta, éxito o error.
- ✅ Logging JSON estructurado con duración y `requestId`.
- ✅ Sin datos sensibles en logs (solo metadata del request).
- ✅ Contrato de respuesta consistente (`{ data, meta }`) vs. errores sin envolver.
- ✅ La misma pipeline corre en producción y e2e (`configure-app.ts`).
- ✅ Los tests **actualizados** al nuevo contrato (no "rotos" sin que nadie mire).

## Verificación del entregable

```bash
npm run build      # compila
npm run lint       # 0 warnings, 0 errors
npm test           # 46 tests unitarios → all passed
npm run test:e2e   # 40 tests e2e → all passed
```

Smoke manual (levanta en 3456 el `dist`):

```bash
node scripts/smoke.mjs   # → SMOKE OK (verifica también header x-request-id)
curl -si http://localhost:3456/auth/me | grep -i x-request-id   # header presente
```

Los 4 tests nuevos de e2e cubren: envoltura `{ data, meta }`, header en éxito y error, correlación con `x-request-id` entrante, y errores sin envolver.

Anterior: [Módulo 4](/guide/module-04) · Siguiente: [Módulo 6](/guide/module-06)
