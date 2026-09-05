import { describe, expect, it, vi } from 'vitest';
import { ScrapingWorkerController } from './scraping-worker.controller.js';

const runtime = {
  jobSource: { sources: ['remoteok', 'weswork'] },
  cronExpr: '0 * * * *',
};

function buildController(workerService: Partial<Record<string, unknown>> = {}) {
  const scrapingWorkerService = {
    enqueueIngest: vi.fn().mockResolvedValue(undefined),
    breakerStates: vi.fn().mockReturnValue({ remoteok: 'closed' }),
    ...workerService,
  };
  const controller = new ScrapingWorkerController(
    scrapingWorkerService as never,
    runtime as never,
  );
  return { controller, scrapingWorkerService };
}

describe('ScrapingWorkerController (request-response del worker)', () => {
  it('scraping.ping responde con cron, fuentes y estado de breakers', () => {
    const { controller } = buildController();
    expect(controller.ping()).toEqual({
      ok: true,
      cron: '0 * * * *',
      sources: ['remoteok', 'weswork'],
      breaker: { remoteok: 'closed' },
    });
  });

  it('scraping.ingest sin source encola todas las fuentes', async () => {
    const { controller, scrapingWorkerService } = buildController();
    const result = await controller.ingest({});
    expect(scrapingWorkerService.enqueueIngest).toHaveBeenCalledTimes(2);
    expect(scrapingWorkerService.enqueueIngest).toHaveBeenCalledWith(
      'remoteok',
      { force: undefined },
    );
    expect(result).toEqual({ enqueued: ['remoteok', 'weswork'] });
  });

  it('scraping.ingest con source específico encola solo esa fuente', async () => {
    const { controller, scrapingWorkerService } = buildController();
    const result = await controller.ingest({ source: 'weswork', force: true });
    expect(scrapingWorkerService.enqueueIngest).toHaveBeenCalledTimes(1);
    expect(scrapingWorkerService.enqueueIngest).toHaveBeenCalledWith(
      'weswork',
      { force: true },
    );
    expect(result).toEqual({ enqueued: ['weswork'] });
  });
});
