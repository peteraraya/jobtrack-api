import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

/**
 * Contexto por request (correlation id). El middleware lo "llena" por cada
 * request entrante; cualquier código que corra DENTRO de ese request (guards,
 * interceptors, pipes, handler, filtros) lo lee con getRequestId() sin pasar
 * el id por parámetros. Basado en AsyncLocalStorage (node:async_hooks).
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
