import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ScrapingService } from './scraping.service.js';

function buildService(overrides: Partial<Record<string, unknown>> = {}) {
  const notifyQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const notificationsService = {
    notifyNewOfferForStack: vi.fn().mockResolvedValue(2),
  };
  const runtime = {
    jobSource: { sources: ['remoteok'] },
    cronExpr: '0 * * * *',
    breakerThreshold: 2,
    breakerCooldownMs: 1000,
    fetchTimeoutMs: 500,
    jobAttempts: 3,
    backoffMs: 100,
    ...overrides,
  };
  const service = new ScrapingService(
    notifyQueue as never,
    notificationsService as never,
    runtime as never,
  );
  return { service, notifyQueue, notificationsService };
}

describe('ScrapingService', () => {
  it('enqueueNotify encola la cola notify con jobId estable', async () => {
    const { service, notifyQueue } = buildService();
    const offer = { id: 'o1', title: 't', stack: ['nestjs'] };
    await service.enqueueNotify(offer);
    expect(notifyQueue.add).toHaveBeenCalledWith(
      'notify',
      { offer },
      expect.objectContaining({
        jobId: 'notify_o1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 100 },
      }),
    );
  });

  it('processNotification delega al servicio de notificaciones', async () => {
    const { service, notificationsService } = buildService();
    const offer = { id: 'o1', title: 't', stack: ['nestjs'] };
    await expect(service.processNotification(offer)).resolves.toBe(2);
    expect(notificationsService.notifyNewOfferForStack).toHaveBeenCalledWith(
      offer,
    );
  });

  it('NotFound 404 se propaga desde el dominio de notificaciones', async () => {
    const { service, notificationsService } = buildService();
    notificationsService.notifyNewOfferForStack.mockRejectedValue(
      new NotFoundException('offer gone'),
    );
    await expect(
      service.processNotification({ id: 'x', title: 't', stack: [] }),
    ).rejects.toThrow(NotFoundException);
  });
});
