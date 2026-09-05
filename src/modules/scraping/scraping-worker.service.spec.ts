import { describe, expect, it, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { ScrapingWorkerService } from './scraping-worker.service.js';
import { OFFER_CREATED_EVENT } from './scrape.events.js';
import type { JobSourceConfig } from '../job-offers/job-source.config.js';

vi.mock('./sources.js', () => ({
  fetchSource: vi.fn(),
}));

import { fetchSource } from './sources.js';

const SOURCES = ['remoteok', 'weswork'];
const jobSource: JobSourceConfig = { sources: SOURCES };

function runtime(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    jobSource,
    cronExpr: '0 * * * *',
    breakerThreshold: 2,
    breakerCooldownMs: 1000,
    fetchTimeoutMs: 500,
    jobAttempts: 3,
    backoffMs: 100,
    ...overrides,
  };
}

function buildService(overrides: Partial<Record<string, unknown>> = {}) {
  const ingestQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const companiesService = {
    ensureBySource: vi.fn().mockResolvedValue({ id: 'c1' }),
  };
  const jobOffersService = {
    upsertFromSource: vi.fn().mockResolvedValue({ offer: {}, created: false }),
  };
  const publisher = { emit: vi.fn().mockReturnValue(of({})) };
  const service = new ScrapingWorkerService(
    ingestQueue as never,
    companiesService as never,
    jobOffersService as never,
    runtime(overrides),
    publisher as never,
  );
  return {
    service,
    ingestQueue,
    companiesService,
    jobOffersService,
    publisher,
    fetchSource,
  };
}

describe('ScrapingWorkerService', () => {
  beforeEach(() => {
    vi.mocked(fetchSource).mockReset();
    vi.mocked(fetchSource).mockResolvedValue([]);
  });

  it('enqueueIngest encola con jobId estable y backoff', async () => {
    const { service, ingestQueue } = buildService();
    await service.enqueueIngest('remoteok');
    expect(ingestQueue.add).toHaveBeenCalledWith(
      'ingest',
      { source: 'remoteok' },
      expect.objectContaining({
        jobId: 'ingest_remoteok',
        attempts: 3,
        backoff: { type: 'exponential', delay: 100 },
      }),
    );
  });

  it('enqueueIngest con force omite jobId (sin dedup)', async () => {
    const { service, ingestQueue } = buildService();
    await service.enqueueIngest('remoteok', { force: true });
    expect(ingestQueue.add).toHaveBeenCalledWith(
      'ingest',
      { source: 'remoteok' },
      expect.objectContaining({ jobId: undefined }),
    );
  });

  it('extractSource ignora fuentes que no están en la config', async () => {
    const { service, fetchSource: fs } = buildService();
    await service.extractSource('unknown');
    expect(fs).not.toHaveBeenCalled();
  });

  it('extractSource publica job-offer.created por cada oferta NUEVA', async () => {
    const { service, jobOffersService, publisher } = buildService();
    let created = true;
    jobOffersService.upsertFromSource.mockImplementation(async () => ({
      offer: { id: 'o1', title: 'Backend', stack: ['nestjs'] },
      created,
    }));
    vi.mocked(fetchSource).mockResolvedValue([
      {
        source: 'remoteok',
        sourceUrl: 'https://remoteok.com/1',
        title: 'Backend',
        description: 'd',
        location: 'Remoto',
        stack: ['nestjs'],
      },
    ]);

    const report = await service.extractSource('remoteok');
    expect(report).toEqual({ ingested: 1, created: 1, notified: 1 });

    // 1ª upsert creada → evento; 2ª (misma fuente) update → sin evento.
    created = false;
    await service.extractSource('remoteok');
    expect(publisher.emit).toHaveBeenCalledTimes(1);
    expect(publisher.emit).toHaveBeenCalledWith(OFFER_CREATED_EVENT, {
      offer: { id: 'o1', title: 'Backend', stack: ['nestjs'] },
    });
  });

  it('breakerStates reporta el estado por fuente tras un fallo', async () => {
    const { service } = buildService({ breakerThreshold: 1 });
    vi.mocked(fetchSource).mockRejectedValue(new Error('down'));
    await expect(service.extractSource('remoteok')).rejects.toThrow('down');
    expect(service.breakerStates()['remoteok']).toBe('open');
  });
});
