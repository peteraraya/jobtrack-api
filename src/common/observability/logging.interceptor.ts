import {
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getRequestId } from './request-context.js';

interface LogParams {
  req: Request;
  res: Response;
  statusCode: number;
  start: number;
  error?: boolean;
}

/**
 * Loggea cada request en una línea JSON: requestId, método, ruta, status y
 * duración. La duración mide handler + interceptores interiores + pipes.
 * En e2e (NODE_ENV=test) se silencia para no ensuciar la salida de vitest;
 * la medición y los headers siguen activos.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  // En e2e (NODE_ENV=test) se silencia para no ensuciar la salida de vitest;
  // en runtime/producción loggea cada request.
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
    if (!this.enabled) {
      return;
    }

    const entry = JSON.stringify({
      level: error ? 'error' : 'info',
      msg: error ? 'request failed' : 'request completed',
      requestId: getRequestId() ?? null,
      method: req.method,
      path: req.originalUrl ?? req.url,
      statusCode,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    });

    if (error) {
      this.logger.error(entry, undefined, this.constructor.name);
    } else {
      this.logger.log(entry, this.constructor.name);
    }
  }
}
