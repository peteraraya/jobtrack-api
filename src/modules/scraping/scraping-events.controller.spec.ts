import { describe, expect, it, vi } from 'vitest';
import { ScrapingEventsController } from './scraping-events.controller.js';

describe('ScrapingEventsController (consumidor de job-offer.created)', () => {
  it('recibe el evento y encola la notificación', async () => {
    const scrapingService = {
      enqueueNotify: vi.fn().mockResolvedValue({ enqueued: true }),
    };
    const controller = new ScrapingEventsController(scrapingService as never);

    const event = {
      offer: { id: 'o1', title: 'Backend', stack: ['nestjs'] },
    };
    await expect(controller.onOfferCreated(event)).resolves.toEqual({
      enqueued: true,
    });
    expect(scrapingService.enqueueNotify).toHaveBeenCalledWith(event.offer);
  });

  it('propaga errores del encolado local', async () => {
    const scrapingService = {
      enqueueNotify: vi.fn().mockRejectedValue(new Error('queue down')),
    };
    const controller = new ScrapingEventsController(scrapingService as never);
    await expect(
      controller.onOfferCreated({
        offer: { id: 'o2', title: 't', stack: [] },
      }),
    ).rejects.toThrow('queue down');
  });
});
