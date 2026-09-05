import { describe, expect, it, vi } from 'vitest';
import { CloseRedisClientOnShutdown } from './close-redis-client-on-shutdown.js';

function buildHook() {
  const client = { close: vi.fn() };
  const hook = new CloseRedisClientOnShutdown(client as never);
  return { hook, client };
}

describe('CloseRedisClientOnShutdown', () => {
  it('al apagar cierra el ClientProxy Redis (Módulo 10)', () => {
    const { hook, client } = buildHook();
    const result = hook.onApplicationShutdown();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });
});
