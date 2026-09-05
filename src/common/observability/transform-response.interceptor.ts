import {
  CallHandler,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getRequestId } from './request-context.js';

export interface ApiMeta {
  timestamp: string;
  requestId: string;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

/**
 * Contrato consistente para TODAS las respuestas exitosas: el payload va en
 * `data` y la metadata de trazabilidad en `meta`. Los errores NO se envuelven
 * (los produce AllExceptionsFilter, fuera del interceptor).
 */
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
        // Downloads / streams se devuelven tal cual (no se envuelven).
        if (data instanceof StreamableFile) {
          return data;
        }
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
