# Código fuente — Módulo 5

Código real del proyecto al cierre del Módulo 5: observabilidad con correlation id, logging y contrato de respuesta.

## `src/common/observability/request-context.ts`

Contexto por request con `AsyncLocalStorage`. Lo escribe el middleware, lo leen todos los demás (interceptors, filtros).

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
```

## `src/common/observability/request-id.middleware.ts`

Middleware de clase (estilo `NestMiddleware`) registrado en `AppModule.configure`. Respeta el id entrante o genera un UUID; lo propaga al header y al contexto ALS.

```ts
import { randomUUID } from 'node:crypto';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestContext.run({ requestId }, () => next());
  }
}
```

## `src/common/observability/logging.interceptor.ts`

Log por request en JSON: `requestId, method, path, statusCode, durationMs`. El `tap` en `next`/`error` escribe solo después de que el handler terminó (o falló).

```ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly enabled = process.env.NODE_ENV !== 'test';

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = performance.now();

    return next.handle().pipe(
      tap({
        next: () => this.write({ req, res, statusCode: res.statusCode, start }),
        error: (error: unknown) => {
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
  }

  private write({ req, statusCode, start, error = false }: LogParams): void {
    if (!this.enabled) return;
    const entry = JSON.stringify({
      level: error ? 'error' : 'info',
      msg: error ? 'request failed' : 'request completed',
      requestId: getRequestId() ?? null,
      method: req.method,
      path: req.originalUrl ?? req.url,
      statusCode,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    });
    error
      ? this.logger.error(entry, undefined, this.constructor.name)
      : this.logger.log(entry, this.constructor.name);
  }
}
```

## `src/common/observability/transform-response.interceptor.ts`

Envuelve toda respuesta exitosa en `{ data, meta }`. Los errores quedan fuera (los arma el filtro).

```ts
@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<
  T,
  unknown
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        return {
          data: data ?? null,
          meta: {
            timestamp: new Date().toISOString(),
            requestId: getRequestId() ?? 'no-request-id',
          },
        };
      }),
    );
  }
}
```

## `src/app.module.ts` (registro)

Middleware + interceptores globales. El orden de ejecución es: middleware primero, luego guards, luego interceptores (logging engloba al transform).

```ts
@Module({
  // ...
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
```

## Contrato de respuesta (Módulo 5)

Éxito:

```json
{
  "data": { "id": "…", "email": "demo@jobtrack.dev", "role": "user" },
  "meta": { "timestamp": "2026-09-04T20:00:00.000Z", "requestId": "…" }
}
```

Error (igual que M3/M4, sin envolver): `{ statusCode, message, errors?, path, timestamp }`.
