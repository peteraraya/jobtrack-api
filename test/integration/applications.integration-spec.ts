import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import pg from 'pg';
import { AppModule } from './../../src/app.module.js';
import { ApplicationsService } from './../../src/modules/applications/applications.service.js';
import { DuplicateApplicationException } from './../../src/modules/applications/exceptions/duplicate-application.exception.js';
import { SlotsExhaustedException } from './../../src/modules/applications/exceptions/slots-exhausted.exception.js';
import { JobOfferNotFoundException } from './../../src/modules/job-offers/exceptions/job-offer-not-found.exception.js';
import { Company } from './../../src/modules/companies/entities/company.entity.js';
import { JobOffer } from './../../src/modules/job-offers/entities/job-offer.entity.js';
import { User } from './../../src/modules/users/entities/user.entity.js';

/**
 * ════════════════════════════════════════════════════════════════════
 * Módulo 6 — INTEGRATION tests (middle de la pirámide).
 * Sin capa HTTP: Services + Repositories + PostgreSQL REAL. Ejercitan el
 * mismo grafo de módulos que producción (AppModule) pero llaman métodos de
 * service, no endpoints. Complementan a los e2e (contrato HTTP) y a los
 * unit (lógica pura con repos mockeados).
 * ════════════════════════════════════════════════════════════════════
 */
describe('applications (integration) — service + repo + Postgres real', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let applicationsService: ApplicationsService;
  let userRepo: Repository<User>;
  let companyRepo: Repository<Company>;
  let offerRepo: Repository<JobOffer>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    await dataSource.synchronize(true);

    applicationsService = app.get(ApplicationsService);
    userRepo = dataSource.getRepository(User);
    companyRepo = dataSource.getRepository(Company);
    offerRepo = dataSource.getRepository(JobOffer);
  });

  afterEach(async () => {
    await app.close();
  });

  async function seedUser(): Promise<User> {
    return userRepo.save(
      userRepo.create({
        email: `it-${crypto.randomUUID()}@jobtrack.dev`,
        passwordHash: 'x',
        role: 'user',
      }),
    );
  }

  async function seedOffer(slots = 3): Promise<JobOffer> {
    const company = await companyRepo.save(
      companyRepo.create({ name: `Co ${crypto.randomUUID()}` }),
    );
    return offerRepo.save(
      offerRepo.create({
        companyId: company.id,
        title: 'Integración',
        sourceUrl: `https://it.dev/${crypto.randomUUID()}`,
        source: 'manual',
        slots,
      }),
    );
  }

  /* ─────────────── Caso feliz: createWithSlotDecrement ─────────── */

  it('apply() crea la postulación y DECREMENTA los cupos en una tx', async () => {
    const user = await seedUser();
    const offer = await seedOffer(3);

    const applied = await applicationsService.apply(user.id, {
      jobOfferId: offer.id,
    });

    expect(applied.userId).toBe(user.id);
    expect(applied.jobOfferId).toBe(offer.id);
    expect(applied.status).toBe('applied');

    const reloaded = await offerRepo.findOneBy({ id: offer.id });
    expect(reloaded?.slots).toBe(2);
  });

  /* ─────────────── Duplicado → DuplicateApplicationException ────── */

  it('apply() dos veces a la misma oferta → DuplicateApplicationException', async () => {
    const user = await seedUser();
    const offer = await seedOffer();

    await applicationsService.apply(user.id, { jobOfferId: offer.id });
    await expect(
      applicationsService.apply(user.id, { jobOfferId: offer.id }),
    ).rejects.toThrow(DuplicateApplicationException);
  });

  /* ─────────────── Oferta inexistente → JobOfferNotFoundException ── */

  it('apply() a una oferta inexistente → JobOfferNotFoundException (y la tx hace rollback)', async () => {
    const user = await seedUser();
    const ghost = crypto.randomUUID();

    await expect(
      applicationsService.apply(user.id, { jobOfferId: ghost }),
    ).rejects.toThrow(JobOfferNotFoundException);

    // El 404 no deja la aplicación a medias (rollback de la transacción).
    const apps = await dataSource
      .getRepository('application')
      .find({ where: { userId: user.id } });
    expect(apps).toHaveLength(0);
  });

  /* ─────────────── Cupos agotados → SlotsExhaustedException ─────── */

  it('apply() con slots en 0 → SlotsExhaustedException y no decrementa a -1', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const offer = await seedOffer(1);

    await applicationsService.apply(userA.id, { jobOfferId: offer.id });

    await expect(
      applicationsService.apply(userB.id, { jobOfferId: offer.id }),
    ).rejects.toThrow(SlotsExhaustedException);

    const reloaded = await offerRepo.findOneBy({ id: offer.id });
    expect(reloaded?.slots).toBe(0); // nunca negativo (condición slots > 0)
  });

  /* ──────────── Reto N+1: UNA query con joins, no 1 + N ─────────── */

  it('findAllWithJobOfferAndCompany hace UNA sola query con joins', async () => {
    // Semántica: medimos cuántos SELECT emite la operación. Si hubiera N+1,
    // serían 1 (aplicaciones) + 1 por cada jobOffer (o + 2 por company).
    const queries: string[] = [];
    const original: (...args: unknown[]) => unknown = pg.Client.prototype
      .query as unknown as (...args: unknown[]) => unknown;
    pg.Client.prototype.query = function patched(
      this: pg.Client,
      ...args: unknown[]
    ): unknown {
      const maybeConfig = args[0] as { text?: string } | undefined;
      const text =
        typeof args[0] === 'object' && maybeConfig ? maybeConfig.text : args[0];
      if (typeof text === 'string') queries.push(text);
      return original.apply(this, args);
    } as pg.Client['query'];

    try {
      for (let i = 0; i < 3; i++) {
        const user = await seedUser();
        const offer = await seedOffer();
        await applicationsService.apply(user.id, { jobOfferId: offer.id });
      }

      queries.length = 0; // medimos solo la operación de lectura

      // Vista admin: TODAS las postulaciones (sin filtro de userId).
      const all = await applicationsService.findAllWithDetails();
      const selects = queries.filter((q) => /^\s*SELECT/i.test(q));

      expect(all).toHaveLength(3);
      // Jerarquía completa cargada en memoria (sin lazy loads pendientes).
      expect(all.every((it) => it.jobOffer && it.jobOffer.company?.name)).toBe(
        true,
      );

      // Reto N+1: una sola SELECT trae application + join job_offer + join company.
      expect(selects).toHaveLength(1);
    } finally {
      pg.Client.prototype.query = original;
    }
  });
});
