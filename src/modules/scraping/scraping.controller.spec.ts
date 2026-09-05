import { describe, expect, it, vi } from 'vitest';
import { of, throwError, TimeoutError } from 'rxjs';
import { ScrapingController } from './scraping.controller.js';

const runtime = {
  jobSource: { sources: ['remoteok', 'weswork'] },
  cronExpr: '0 * * * *',
};

function buildController(client: Partial<{ send: ReturnType<typeof vi.fn> }>) {
  const workerClient = {
    send: vi.fn(),
    ...client,
  };
  const controller = new ScrapingController(
    { enqueueNotify: vi.fn() } as never,
    { getJobCounts: vi.fn().mockResolvedValue({ waiting: 0 }) } as never,
    { getJobCounts: vi.fn().mockResolvedValue({ waiting: 1 }) } as never,
    runtime as never,
    workerClient as never,
  );
  return { controller, workerClient };
}

describe('ScrapingController (proxy al worker)', () => {
  it('POST ingest delega el comando al worker por Redis', async () => {
    const { controller, workerClient } = buildController({});
    workerClient.send.mockReturnValue(of({ enqueued: ['remoteok'] }));
    const result = await controller.ingest({ source: 'remoteok', force: true });
    expect(workerClient.send).toHaveBeenCalledWith('scraping.ingest', {
      source: 'remoteok',
      force: true,
    });
    expect(result).toEqual({ enqueued: ['remoteok'] });
  });

  it('GET worker reporta up cuando el ping responde', async () => {
    const { controller, workerClient } = buildController({});
    workerClient.send.mockReturnValue(
      of({ ok: true, cron: '*', sources: [], breaker: {} }),
    );
    const result = await controller.worker();
    expect(result.status).toBe('up');
    expect(result.worker?.ok).toBe(true);
  });

  it('GET worker reporta down cuando el ping falla o expira', async () => {
    const { controller, workerClient } = buildController({});
    workerClient.send.mockReturnValue(throwError(() => new TimeoutError()));
    const result = await controller.worker();
    expect(result.status).toBe('down');
    expect(result.worker).toBeUndefined();
  });

  it('GET state combina conteos de cola locales y estado del worker', async () => {
    const { controller, workerClient } = buildController({});
    workerClient.send.mockReturnValue(
      of({ ok: true, cron: '*', sources: [], breaker: {} }),
    );
    const state = await controller.state();
    expect(state.cron).toBe('0 * * * *');
    expect(state.sources).toEqual(['remoteok', 'weswork']);
    expect(state.worker).toBe('up');
    expect(state.ingest).toEqual({ waiting: 0 });
    expect(state.notify).toEqual({ waiting: 1 });
  });
});
