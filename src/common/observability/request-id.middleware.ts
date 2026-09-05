import { randomUUID } from 'node:crypto';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Middleware de correlación: asigna un requestId a cada request entrante.
 * Respeta el header x-request-id si viene del cliente (para trazabilidad
 * cross-service del lado del gateway) o genera un UUID. Corre ANTES de
 * guards/interceptors/pipes/handler, porque vive a nivel "before routing".
 */
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestContext.run({ requestId }, () => next());
  }
}
