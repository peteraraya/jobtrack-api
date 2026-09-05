import type { ExecutionContext } from '@nestjs/common';
import { HttpException, Logger } from '@nestjs/common';
import type { CallHandler } from '@nestjs/common';
import type { Request, Response } from 'express';
import { throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor.js';
import { requestContext } from './request-context.js';

describe('LoggingInterceptor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function ctx(
    method: string,
    path: string,
    statusCode: number,
  ): ExecutionContext {
    const req = { method, originalUrl: path, url: path } as unknown as Request;
    const res = { statusCode } as unknown as Response;
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
  }

  it('loguea requestId + método + ruta + status + duración en JSON', async () => {
    vi.stubEnv('NODE_ENV', 'production'); // habilita el logging del interceptor
    const logSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const interceptor = new LoggingInterceptor();

    const handle: CallHandler = {
      handle: () => throwError(() => new HttpException('boom', 409)),
    };
    const promise = new Promise<void>((resolve) => {
      requestContext.run({ requestId: 'req-123' }, () => {
        interceptor
          .intercept(ctx('POST', '/job-offers/1', 409), handle)
          .subscribe({ error: () => resolve() });
      });
    });
    await promise;

    expect(logSpy).toHaveBeenCalled();
    const entry = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(entry);
    expect(parsed.requestId).toBe('req-123');
    expect(parsed.method).toBe('POST');
    expect(parsed.path).toBe('/job-offers/1');
    expect(parsed.statusCode).toBe(409);
    expect(parsed.level).toBe('error');
    expect(parsed.durationMs).toEqual(expect.any(Number) as number);
    logSpy.mockRestore();
  });

  it('se silencia en e2e (NODE_ENV=test)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const logSpy = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const interceptor = new LoggingInterceptor(); // deshabilitado en test
    const handle: CallHandler = {
      handle: () => throwError(() => new HttpException('boom', 500)),
    };

    requestContext.run({ requestId: 'req-x' }, () => {
      interceptor
        .intercept(ctx('GET', '/health', 500), handle)
        .subscribe({ error: () => undefined });
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
