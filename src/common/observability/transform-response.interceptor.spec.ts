import { Observable } from 'rxjs';
import { ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { TransformResponseInterceptor } from './transform-response.interceptor.js';
import {
  REQUEST_ID_HEADER,
  RequestIdMiddleware,
} from './request-id.middleware.js';
import { requestContext } from './request-context.js';

describe('TransformResponseInterceptor', () => {
  const interceptor = new TransformResponseInterceptor<{ id: string }>();

  function ctx(): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
    } as unknown as ExecutionContext;
  }

  it('envuelve la respuesta en { data, meta }', async () => {
    const source = of({ id: 'abc' });
    const callHandler = { handle: () => source as Observable<{ id: string }> };
    const requestId = '00000000-1111-4222-8333-444444444444';

    const result = await new Promise((resolve) => {
      requestContext.run({ requestId }, () => {
        interceptor.intercept(ctx(), callHandler).subscribe(resolve);
      });
    });

    expect(result).toEqual({
      data: { id: 'abc' },
      meta: {
        timestamp: expect.any(String) as string,
        requestId,
      },
    });
  });

  it('coerciona undefined a null para mantener la forma { data, meta }', async () => {
    const source = of(undefined as unknown as { id: string });
    const callHandler = { handle: () => source as Observable<{ id: string }> };

    const result = await new Promise((resolve) => {
      requestContext.run({ requestId: 'x' }, () => {
        interceptor.intercept(ctx(), callHandler).subscribe(resolve);
      });
    });

    expect((result as { data: unknown }).data).toBeNull();
  });
});

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  it('genera un UUID y lo expone en header y contexto cuando no viene', async () => {
    const res = { setHeader: vi.fn() };
    const req = { header: vi.fn().mockReturnValue(undefined) };

    let seenId: string | undefined;
    await new Promise<void>((done) => {
      middleware.use(req as never, res as never, () => {
        seenId = requestContext.getStore()?.requestId;
        done();
      });
    });

    expect(seenId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seenId).toBe(seenId);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, seenId);
  });

  it('respeta el x-request-id entrante', async () => {
    const incoming = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const res = { setHeader: vi.fn() };
    const req = { header: vi.fn().mockReturnValue(incoming) };

    let seenId: string | undefined;
    await new Promise<void>((done) => {
      middleware.use(req as never, res as never, () => {
        seenId = requestContext.getStore()?.requestId;
        done();
      });
    });

    expect(seenId).toBe(incoming);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, incoming);
  });
});

describe('(integración) requestId vive dentro del request, no fuera', () => {
  it('fuera del contexto ALS requestId es undefined', () => {
    expect(requestContext.getStore()).toBeUndefined();
    expect(middlewareGuard()).toBeUndefined();
  });

  function middlewareGuard(): string | undefined {
    // Getter fuera de cualquier run() — el ALS no filtra IDs entre requests.
    return requestContext.getStore()?.requestId;
  }
});
