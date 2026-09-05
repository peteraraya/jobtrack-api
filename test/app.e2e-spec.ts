import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Transport } from '@nestjs/microservices';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import {
  io as createSocket,
  type Socket as ClientSocket,
} from 'socket.io-client';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/configure-app.js';
import { parseRedisUrl } from './../src/config/redis.client.js';
import { ScrapingWorkerModule } from './../src/modules/scraping/scraping-worker.module.js';
import { REQUEST_ID_HEADER } from './../src/common/observability/request-id.middleware.js';
import { NotificationsService } from './../src/modules/notifications/notifications.service.js';
import {
  INGEST_QUEUE,
  NOTIFY_QUEUE,
} from './../src/modules/scraping/queues.contants.js';

const PASSWORD = 'Password123!';

interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: 'admin' | 'user' };
}

/**
 * Módulo 5: TODAS las respuestas exitosas vienen envueltas en
 * { data, meta: { timestamp, requestId } }. Los errores NO se envuelven
 * (los arma AllExceptionsFilter). por eso los expect(200/201) leen .data.
 */
type Envelope<T> = { data: T; meta: { timestamp: string; requestId: string } };

/* ════════════════════════════════════════════════════════════════════
   Módulo 4 — Auth JWT, Guards, RBAC, ownership y refresh rotation.
   Cada test usa una app nueva: el rate limit (en memoria) se reinicia
   por app, así los tests de throttling no se pisan entre sí.
   ════════════════════════════════════════════════════════════════════ */
describe('JobTrack API (e2e)', () => {
  let app: INestApplication<App>;
  let workerApp: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Módulo 9 — el API escucha (consumidor) el transporte Redis por el que el
    // worker publica `job-offer.created`. Debe registrarse ANTES de init.
    app.connectMicroservice({
      transport: Transport.REDIS,
      options: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });

    // Esquema real y limpio para cada test: sincroniza ANTES de que existan
    // los workers de BullMQ (app.init los arranca), así ningún job viejo
    // procesa contra un esquema a medio dropear.
    await app.get(DataSource).synchronize(true);

    // Misma pipeline que producción (pipes + filtro global + helmet + CORS).
    configureApp(app);

    // Arranca ambos transportes: HTTP (gateway) + Redis (eventos del worker).
    await app.startAllMicroservices();
    await app.init();

    // Redis persiste entre apps: las corridas forzadas de tests previos dejan
    // jobs huérfanos en las colas. Los purgamos para aislar cada test. Esto
    // ocurre ANTES de levantar el microservicio worker, para que no consuma
    // jobs viejos contra un esquema recién sincronizado.
    for (const queue of [INGEST_QUEUE, NOTIFY_QUEUE]) {
      await app.get(getQueueToken(queue)).obliterate({ force: true });
    }

    // Módulo 9 — microservicio worker de scraping en el MISMO proceso de test:
    // procesa la cola `ingest` (extractSource → publica job-offer.created) y
    // responde request-response (scraping.ping / scraping.ingest) por Redis.
    const workerFixture: TestingModule = await Test.createTestingModule({
      imports: [ScrapingWorkerModule],
    }).compile();
    workerApp = workerFixture.createNestMicroservice({
      transport: Transport.REDIS,
      options: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });
    await workerApp.init();
    await workerApp.listen();
  });

  afterEach(async () => {
    await workerApp.close();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // Crea un usuario por SQL (role arbitrario, incluido admin) y login con él.
  async function sessionFor(role: 'admin' | 'user'): Promise<Session> {
    const email = `${role}-${crypto.randomUUID()}@jobtrack.dev`;
    const passwordHash = await hash(PASSWORD, 8);
    await app
      .get(DataSource)
      .query(
        `INSERT INTO "user" ("email", "passwordHash", "role") VALUES ($1, $2, $3)`,
        [email, passwordHash, role],
      );
    const login = await http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return (login.body as Envelope<Session>).data;
  }

  async function registerUser(): Promise<Session> {
    const email = `user-${crypto.randomUUID()}@jobtrack.dev`;
    const res = await http()
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    return (res.body as Envelope<Session>).data;
  }

  // Crea company + offer como admin y devuelve el id de la oferta.
  async function createOffer(
    title: string,
    sourceUrl: string,
  ): Promise<string> {
    const admin = await sessionFor('admin');
    const company = await http()
      .post('/v1/companies')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: title })
      .expect(201);
    const offer = await http()
      .post('/v1/job-offers')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ companyId: company.body.data.id, title, sourceUrl })
      .expect(201);
    return offer.body.data.id as string;
  }

  // Helpers para el pipeline asíncrono del Módulo 7 (la cola procesa en
  // background): polling con timeout acotado, sin dormir ciegamente.
  async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForCondition<T>(
    fetch: () => Promise<T>,
    predicate: (value: T) => boolean,
    attempts: number,
    delayMs: number,
    label: string,
  ): Promise<T> {
    for (let i = 0; i < attempts; i += 1) {
      const value = await fetch();
      if (predicate(value)) return value;
      await sleep(delayMs);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  // Jobs sin terminar de un contador de cola BullMQ (getJobCounts). Incluye
  // `delayed`: jobs en mid-retry (backoff) aún no se consideran drenados.
  function remainingJobs(counts: Record<string, number>): number {
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
  }

  /* ───────────────────── Observabilidad (Módulo 5) ───────────────── */

  it('GET /health reporta ok con el ping a la base, sin token', () => {
    return http()
      .get('/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.status).toBe('ok');
        expect(body.data.details.database.status).toBe('up');
      });
  });

  it('respuestas exitosas vienen envueltas en { data, meta } con requestId', async () => {
    const res = await http().get('/v1/companies').expect(200);

    const envelope = res.body as Envelope<unknown[]>;
    expect(Array.isArray(envelope.data)).toBe(true);
    expect(typeof envelope.meta.timestamp).toBe('string');
    expect(envelope.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('el header x-request-id viaja en TODA respuesta (éxito y error)', async () => {
    const ok = await http().get('/health').expect(200);
    expect(ok.headers[REQUEST_ID_HEADER]).toBeDefined();

    const err = await http().get('/v1/companies/nope').expect(404);
    expect(err.headers[REQUEST_ID_HEADER]).toBeDefined();
    // El id de la respuesta coincide con el id de meta (misma request).
    expect(err.body.statusCode).toBe(404);
  });

  it('respeta el x-request-id entrante (correlación cross-service)', async () => {
    const clientId = '11111111-2222-4333-8444-555555555555';
    const res = await http()
      .get('/health')
      .set(REQUEST_ID_HEADER, clientId)
      .expect(200);

    expect(res.headers[REQUEST_ID_HEADER]).toBe(clientId);
    expect((res.body as Envelope<unknown>).meta.requestId).toBe(clientId);
  });

  it('los ERRORES no se envuelven (contrato de error de M2/M4 intacto)', async () => {
    const res = await http().get('/v1/companies/not-a-uuid').expect(404);
    expect(res.body.data).toBeUndefined();
    expect(res.body.statusCode).toBe(404);
    expect(res.body.path).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });

  it('seguridad: headers de helmet hardening + sin X-Powered-By (Módulo 10)', async () => {
    const res = await http().get('/v1/companies').expect(200);

    // Defaults de helmet (Módulo 4): frame, nosniff, CSP, HSTS.
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();

    // Hardening del Módulo 10.
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['origin-agent-cluster']).toBe('?1');

    // helmet oculta la firma del framework (fingerprinting).
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  /* ─────────────────────────── Auth: register/login ─────────────── */

  describe('auth', () => {
    it('POST /auth/register crea un usuario role=user y devuelve tokens', async () => {
      const { body } = await http()
        .post('/v1/auth/register')
        .send({ email: 'new@jobtrack.dev', password: PASSWORD })
        .expect(201);

      const payload = (body as Envelope<Session>).data;
      expect(payload.user.email).toBe('new@jobtrack.dev');
      expect(payload.user.role).toBe('user');
      expect(payload.accessToken).toBeDefined();
      expect(payload.refreshToken).toBeDefined();
    });

    it('POST /auth/register rechaza email duplicado con 409', async () => {
      const email = `dup-${crypto.randomUUID()}@jobtrack.dev`;
      await http()
        .post('/v1/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201);

      const res = await http()
        .post('/v1/auth/register')
        .send({ email, password: PASSWORD })
        .expect(409);

      expect(res.body.statusCode).toBe(409);
      expect(res.body.message).toContain('already registered');
    });

    it('POST /auth/login devuelve tokens con credenciales válidas', async () => {
      const user = await registerUser();

      const { body } = await http()
        .post('/v1/auth/login')
        .send({ email: user.user.email, password: PASSWORD })
        .expect(201);

      const payload = (body as Envelope<Session>).data;
      expect(payload.accessToken).toBeDefined();
      expect(payload.refreshToken).toBeDefined();
    });

    it('POST /auth/login con password incorrecta → 401', async () => {
      const user = await registerUser();
      const res = await http()
        .post('/v1/auth/login')
        .send({ email: user.user.email, password: 'WrongPass123!' })
        .expect(401);

      expect(res.body.statusCode).toBe(401);
      expect(res.body.message).toContain('Invalid email or password');
    });

    it('POST /auth/login con email inexistente → 401 (sin enumerar)', async () => {
      const res = await http()
        .post('/v1/auth/login')
        .send({
          email: `ghost-${crypto.randomUUID()}@jobtrack.dev`,
          password: PASSWORD,
        })
        .expect(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('GET /auth/me sin token → 401', async () => {
      const res = await http().get('/v1/auth/me').expect(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('GET /auth/me con token devuelve el usuario autenticado', async () => {
      const user = await sessionFor('user');

      const { body } = await http()
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const me = (body as Envelope<Session['user']>).data;
      expect(me.id).toBe(user.user.id);
      expect(me.email).toBe(user.user.email);
      expect(me.role).toBe('user');
    });

    it('flujo completo (M6): registro → login → me → 401 sin token → 403 como user → 201 como admin', async () => {
      // 1) Registro: nace como role=user y recibe tokens.
      const { body: registerBody } = await http()
        .post('/v1/auth/register')
        .send({
          email: `flow-${crypto.randomUUID()}@jobtrack.dev`,
          password: PASSWORD,
        })
        .expect(201);
      const registered = (registerBody as Envelope<Session>).data;
      expect(registered.user.role).toBe('user');
      expect(registered.refreshToken).toBeTruthy();

      // 2) Login con las credenciales que acabamos de crear.
      const { body: loginBody } = await http()
        .post('/v1/auth/login')
        .send({ email: registered.user.email, password: PASSWORD })
        .expect(201);
      const session = (loginBody as Envelope<Session>).data;
      expect(session.accessToken).toBeTruthy();

      // 3) /auth/me con el token → el usuario autenticado.
      const me = await http()
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      // 4) Mismo endpoint sin token → 401 (la auth protege por defecto).
      await http().get('/v1/auth/me').expect(401);

      // 5) Endpoint restringido a admin sin rol → 403 (RBAC).
      await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ name: 'Prohibited' })
        .expect(403);

      // 6) El mismo endpoint con un admin → 201.
      const admin = await sessionFor('admin');
      const { body: adminBody } = await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Allowed' })
        .expect(201);
      expect(adminBody.data.name).toBe('Allowed');

      expect((me.body as Envelope<Session['user']>).data.id).toBe(
        session.user.id,
      );
    });
  });

  /* ─────────── Refresh rotation: el viejo muere en cada uso ─────── */

  describe('refresh token rotation', () => {
    it('rotar invalida el refresh anterior (reutilización → 401)', async () => {
      const user = await registerUser();

      const first = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(201);
      expect(first.body.data.refreshToken).not.toBe(user.refreshToken);

      // El refresh ORIGINAL ya fue rotado: reutilizarlo debe fallar.
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);

      // Pero el NUEVO refresh sigue funcionando.
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.body.data.refreshToken })
        .expect(201);
    });

    it('POST /auth/refresh con token inválido → 401', async () => {
      const res = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'not-a-jwt' })
        .expect(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('POST /auth/logout invalida el refresh de la sesión', async () => {
      const user = await registerUser();

      await http()
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });
  });

  /* ─────────────────── Throttling en /auth/login ────────────────── */

  describe('rate limiting (auth)', () => {
    it('6 logins rápidos → el último recibe 429', async () => {
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/v1/auth/login')
          .send({
            email: `throttle-${i}@jobtrack.dev`,
            password: PASSWORD,
          });
      }

      const res = await http().post('/v1/auth/login').send({
        email: 'throttle-6@jobtrack.dev',
        password: PASSWORD,
      });

      expect(res.status).toBe(429);
      expect(res.body.statusCode).toBe(429);
    });
  });

  /* ─────────────────── RBAC: companies / job-offers ─────────────── */

  describe('RBAC (roles)', () => {
    it('POST /companies sin token → 401', async () => {
      const res = await http()
        .post('/v1/companies')
        .send({ name: 'Acme' })
        .expect(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('POST /companies con usuario común → 403', async () => {
      const user = await sessionFor('user');
      const res = await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Acme' })
        .expect(403);

      expect(res.body.statusCode).toBe(403);
      expect(res.body.message).toContain('admin');
    });

    it('POST /companies con admin → 201', async () => {
      const admin = await sessionFor('admin');
      const { body } = await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: '  Acme  ' })
        .expect(201);

      expect(body.data.name).toBe('Acme'); // trim sigue funcionando
    });

    it('GET /companies es público (catálogo), sin token', async () => {
      await http().get('/v1/companies').expect(200);
    });

    it('POST /job-offers sin token → 401 y persiste slots/source como admin', async () => {
      await http()
        .post('/v1/job-offers')
        .send({
          companyId: 'd1a4c2e5-eefe-4f0a-9d5f-9b8f8b6e4300',
          title: 'Dev',
          sourceUrl: 'https://x.dev/1',
        })
        .expect(401);

      const admin = await sessionFor('admin');
      const company = await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Persist' })
        .expect(201);

      const { body } = await http()
        .post('/v1/job-offers')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          companyId: company.body.data.id,
          title: 'Persistido',
          sourceUrl: 'https://persist.com/careers/1',
        })
        .expect(201);

      expect(body.data.source).toBe('manual');
      expect(body.data.slots).toBe(3);
    });

    it('POST /job-offers sourceUrl duplicada → 409 (como admin)', async () => {
      const admin = await sessionFor('admin');
      const company = await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Duplicada' })
        .expect(201);

      const offer = {
        companyId: company.body.data.id,
        title: 'Oferta',
        sourceUrl: 'https://duplicada.dev/careers/1',
      };

      await http()
        .post('/v1/job-offers')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(offer)
        .expect(201);

      await http()
        .post('/v1/job-offers')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ ...offer, title: 'Copia' })
        .expect(409);
    });
  });

  /* ─────────────── Aplicaciones: userId del token + scope ───────── */

  describe('applications (auth + scope)', () => {
    it('POST /applications usa el userId del TOKEN (no del body)', async () => {
      const user = await registerUser();
      const offerId = await createOffer('Nest Co', 'https://nest.co/careers/1');

      const res = await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ jobOfferId: offerId })
        .expect(201);

      expect(res.body.data.userId).toBe(user.user.id);
      expect(res.body.data.status).toBe('applied');
    });

    it('POST /applications sin token → 401', async () => {
      await http()
        .post('/v1/applications')
        .send({ jobOfferId: 'd1a4c2e5-eefe-4f0a-9d5f-9b8f8b6e4300' })
        .expect(401);
    });

    it('POST /applications 409 al postular dos veces a la misma oferta', async () => {
      const user = await registerUser();
      const offerId = await createOffer('Doble', 'https://doble.dev/careers/1');

      const headers = ['Authorization', `Bearer ${user.accessToken}`] as [
        string,
        string,
      ];
      await http()
        .post('/v1/applications')
        .set(...headers)
        .send({ jobOfferId: offerId })
        .expect(201);

      const res = await http()
        .post('/v1/applications')
        .set(...headers)
        .send({ jobOfferId: offerId })
        .expect(409);

      expect(res.body.message).toContain('already applied');
    });

    it('POST /applications 409 cuando la oferta no tiene cupos', async () => {
      const userA = await registerUser();
      const userB = await registerUser();
      const offerId = await createOffer('Cupos', 'https://cupos.dev/careers/1');

      await app
        .get(DataSource)
        .query(`UPDATE "job_offer" SET "slots" = 1 WHERE "id" = $1`, [offerId]);

      await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ jobOfferId: offerId })
        .expect(201);

      const res = await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ jobOfferId: offerId })
        .expect(409);

      expect(res.body.message).toContain('no available slots');
    });

    it('GET /applications: el usuario solo ve SUS postulaciones (scope)', async () => {
      const userA = await registerUser();
      const userB = await registerUser();
      const offerA = await createOffer('Scope A', 'https://scope-a.dev/1');
      const offerB = await createOffer('Scope B', 'https://scope-b.dev/1');

      await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ jobOfferId: offerA })
        .expect(201);
      await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ jobOfferId: offerB })
        .expect(201);

      const { body } = await http()
        .get('/v1/applications')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      const mine = (body as Envelope<unknown[]>).data;
      expect(mine).toHaveLength(1);
      expect((mine[0] as { userId: string }).userId).toBe(userA.user.id);
    });

    it('GET /applications (admin) resuelve el N+1: jerarquía en una respuesta', async () => {
      const userA = await registerUser();
      const userB = await registerUser();
      const offerA = await createOffer('Nest Dev', 'https://nplus1.dev/a');
      const offerB = await createOffer('React Co', 'https://nplus1.dev/b');

      await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ jobOfferId: offerA })
        .expect(201);
      await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ jobOfferId: offerB })
        .expect(201);

      const admin = await sessionFor('admin');
      const res = await http()
        .get('/v1/applications')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const items = (res.body as Envelope<unknown[]>).data;
      expect(items).toHaveLength(2);
      const titles = items.map(
        (it: { jobOffer: { title: string } }) => it.jobOffer.title,
      );
      expect(titles).toEqual(expect.arrayContaining(['Nest Dev', 'React Co']));
      const companies = items.map(
        (it: { jobOffer: { company: { name: string } } }) =>
          it.jobOffer.company.name,
      );
      expect(companies).toEqual(
        expect.arrayContaining(['Nest Dev', 'React Co']),
      );
    });
  });

  /* ─────────────── Ownership en PATCH /applications/:id ─────────── */

  describe('ownership (PATCH /applications/:id)', () => {
    it('el intruso recibe 403 aunque adivine el ID de la aplicación ajena', async () => {
      const userA = await registerUser();
      const intruder = await sessionFor('user');
      const offerId = await createOffer('Own', 'https://own.dev/careers/1');

      const application = await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ jobOfferId: offerId })
        .expect(201);

      const res = await http()
        .patch(`/v1/applications/${application.body.data.id}`)
        .set('Authorization', `Bearer ${intruder.accessToken}`)
        .send({ status: 'rejected' })
        .expect(403);

      expect(res.body.statusCode).toBe(403);
    });

    it('el DUEÑO cambia su propio estado → 200', async () => {
      const user = await registerUser();
      const offerId = await createOffer('Owner', 'https://owner.dev/careers/1');

      const application = await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ jobOfferId: offerId })
        .expect(201);

      const { body } = await http()
        .patch(`/v1/applications/${application.body.data.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'interview' })
        .expect(200);

      expect(body.data.status).toBe('interview');
    });

    it('ADMIN cambia el estado de una aplicación ajena → 200', async () => {
      const user = await registerUser();
      const admin = await sessionFor('admin');
      const offerId = await createOffer('Admin', 'https://admin.dev/careers/1');

      const application = await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ jobOfferId: offerId })
        .expect(201);

      const adminId = await http()
        .patch(`/v1/applications/${application.body.data.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: 'offer' })
        .expect(200);

      expect(adminId.body.data.status).toBe('offer');
    });

    it('PATCH con status inválido → 400 (validación)', async () => {
      const user = await registerUser();
      const offerId = await createOffer('Val', 'https://val.dev/careers/1');

      const application = await http()
        .post('/v1/applications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ jobOfferId: offerId })
        .expect(201);

      await http()
        .patch(`/v1/applications/${application.body.data.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'hired_as_ceo' })
        .expect(400);
    });

    it('PATCH de una aplicación inexistente → 404 estructurado', async () => {
      const user = await registerUser();
      const res = await http()
        .patch(`/v1/applications/3f7a5a59-cf45-4832-a5e5-b6e36319e4b0`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'rejected' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.timestamp).toBeDefined();
    });
  });

  /* ─────────── ─────── Scraping pipeline (Módulo 7) ─────────────── */

  describe('scraping pipeline (Módulo 7)', () => {
    type Offer = Record<string, unknown>;

    async function offersInDb(): Promise<Offer[]> {
      const ds = app.get(DataSource);
      return ds.query('SELECT * FROM job_offer ORDER BY "postedAt" DESC');
    }

    it('POST /scraping/ingest sin rol admin → 403', async () => {
      const user = await sessionFor('user');
      await http()
        .post('/v1/scraping/ingest')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ force: true })
        .expect(403);
    }, 60_000);

    it('admin dispara ingest: el worker crea ofertas de la fuente y el upsert no duplica', async () => {
      const admin = await sessionFor('admin');

      const runIngest = async (body: Record<string, unknown>) => {
        await http()
          .post('/v1/scraping/ingest')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send(body)
          .expect(202);
        // Espera a que la cola de ingest se vacíe por completo (active=0 y
        // waiting=0): medir antes es una carrera con el worker en background.
        await waitForCondition(
          () =>
            http()
              .get('/v1/scraping/state')
              .set('Authorization', `Bearer ${admin.accessToken}`),
          (res) => {
            const ingest = (
              res.body as Envelope<{ ingest: Record<string, number> }>
            ).data.ingest;
            return remainingJobs(ingest) === 0;
          },
          80,
          250,
          'cola de ingest vacía',
        );
      };

      // Primera corrida: crea las ofertas de la fuente.
      await runIngest({ force: true });
      const afterFirst = await offersInDb();
      const source = afterFirst.find((offer) => offer.source !== 'manual')
        ?.source as string;
      expect(source).toBeTruthy();
      const countBefore = afterFirst.filter(
        (offer) => offer.source === source,
      ).length;
      expect(countBefore).toBeGreaterThan(0);

      // Segunda corrida forzada de la misma fuente: las mismas sourceUrl se
      // ACTUALIZAN (ON CONFLICT DO UPDATE), no se duplican.
      await runIngest({ source, force: true });
      const afterSecond = await offersInDb();
      expect(
        afterSecond.filter((offer) => offer.source === source),
      ).toHaveLength(countBefore);
    }, 60_000);

    it('una oferta nueva cuyo stack matchea un perfil crea una notificación', async () => {
      const user = await sessionFor('user');
      const ds = app.get(DataSource);
      await ds.query(
        'INSERT INTO profile ("userId", "stack", "yearsOfExperience") VALUES ($1, $2, $3)',
        [user.user.id, 'typescript,nestjs', 4],
      );

      const admin = await sessionFor('admin');
      await http()
        .post('/v1/scraping/ingest')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ force: true })
        .expect(202);

      // Espera a que la cola de ingest se drene igual que en el test del
      // upsert: solo después sabemos que los jobs de notify ya se encolaron.
      await waitForCondition(
        () =>
          http()
            .get('/v1/scraping/state')
            .set('Authorization', `Bearer ${admin.accessToken}`),
        (res) => {
          const ingest = (
            res.body as Envelope<{ ingest: Record<string, number> }>
          ).data.ingest;
          return remainingJobs(ingest) === 0;
        },
        80,
        250,
        'cola de ingest vacía (notificaciones)',
      );

      const notifications = await waitForCondition(
        () =>
          ds.query(
            'SELECT * FROM notification WHERE "userId" = $1 ORDER BY "createdAt"',
            [user.user.id],
          ),
        (rows) => rows.length > 0,
        80,
        250,
        'notificaciones por match de stack',
      );
      expect(notifications[0].type).toBe('new_offer');
      expect(
        (notifications[0] as { payload: { offerId?: string } }).payload.offerId,
      ).toBeTruthy();
    }, 60_000);

    it('GET /scraping/state expone cron, fuentes y conteos de cola (solo admin)', async () => {
      const user = await sessionFor('user');
      await http()
        .get('/v1/scraping/state')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);

      const admin = await sessionFor('admin');
      const { body } = await http()
        .get('/v1/scraping/state')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const data = (
        body as Envelope<{
          cron: string;
          sources: string[];
          ingest: Record<string, number>;
          notify: Record<string, number>;
        }>
      ).data;
      expect(Array.isArray(data.sources)).toBe(true);
      expect(typeof data.cron).toBe('string');
      expect(data.ingest).toBeDefined();
      expect(data.notify).toBeDefined();
    }, 60_000);
  });

  /* ───────────── Microservicio worker (Módulo 9) ──────────────────── */

  describe('microservicio worker (Módulo 9)', () => {
    it('GET /scraping/worker devuelve up con el ping del microservicio (solo admin)', async () => {
      const user = await sessionFor('user');
      await http()
        .get('/v1/scraping/worker')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);

      const admin = await sessionFor('admin');
      const { body } = await http()
        .get('/v1/scraping/worker')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const data = (
        body as Envelope<{
          status: string;
          worker: { ok: boolean; cron: string; sources: string[] };
        }>
      ).data;
      expect(data.status).toBe('up');
      expect(data.worker.ok).toBe(true);
      expect(typeof data.worker.cron).toBe('string');
      expect(Array.isArray(data.worker.sources)).toBe(true);
    }, 60_000);

    it('POST /scraping/ingest delega el comando al worker y reporta qué encoló', async () => {
      const admin = await sessionFor('admin');
      const { body } = await http()
        .post('/v1/scraping/ingest')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ source: 'remoteok', force: true })
        .expect(202);

      const data = (body as Envelope<{ enqueued: string[] }>).data;
      expect(Array.isArray(data.enqueued)).toBe(true);
      expect(data.enqueued).toContain('remoteok');
    }, 60_000);

    it('el evento job-offer.created del worker llega al API y encola notify', async () => {
      const ds = app.get(DataSource);
      const admin = await sessionFor('admin');

      // El worker procesa el ingest (extrae → publica el evento) y el API lo
      // consume → encola local → NotifyProcessor. El corte: la cola de ingest
      // queda vacía y la de notify dejó de ser uniformemente cero o pasó a
      // tener jobs (completados). Chequeamos el estado final de ambas.
      await http()
        .post('/v1/scraping/ingest')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ force: true })
        .expect(202);

      // La cadena completa termina cuando la cola ingest se drena y notify
      // también (los jobs del worker visualizan el flujo worker→API).
      await waitForCondition(
        () =>
          http()
            .get('/v1/scraping/state')
            .set('Authorization', `Bearer ${admin.accessToken}`),
        (res) => {
          const data = (
            res.body as Envelope<{
              ingest: Record<string, number>;
              notify: Record<string, number>;
            }>
          ).data;
          return (
            remainingJobs(data.ingest) === 0 && remainingJobs(data.notify) === 0
          );
        },
        80,
        250,
        'pipelines worker y notify drenados',
      );

      const offers = await ds.query(
        'SELECT * FROM job_offer WHERE "source" IS NOT NULL',
      );
      expect(offers.length).toBeGreaterThan(0);
    }, 60_000);
  });

  /* ─────────────── Validación y errores 400 (mantiene M2/M3) ────── */

  describe('validación de input (400)', () => {
    it('POST /companies (admin) rechaza campos desconocidos', async () => {
      const admin = await sessionFor('admin');
      const res = await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Acme', hack: true })
        .expect(400);

      expect(res.body.errors).toEqual([
        { field: 'hack', message: expect.any(String) },
      ]);
    });

    it('POST /companies (admin) rechaza nombre en blanco tras el trim', async () => {
      const admin = await sessionFor('admin');
      await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: '   ' })
        .expect(400);
    });

    it('POST /companies (admin) rechaza body mayor a 1mb (413)', async () => {
      const admin = await sessionFor('admin');
      const res = await http()
        .post('/v1/companies')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'x'.repeat(2 * 1024 * 1024) })
        .expect(413);

      expect(res.body.statusCode).toBe(413);
    });

    it('POST /auth/register con password corta → 400', async () => {
      const res = await http()
        .post('/v1/auth/register')
        .send({ email: 'short@jobtrack.dev', password: '123' })
        .expect(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          { field: 'password', message: expect.any(String) },
        ]),
      );
    });

    it('GET /job-offers rechaza un limit fuera de rango (público)', async () => {
      await http().get('/v1/job-offers?limit=1000').expect(400);
    });

    it('GET /companies/:id inexistente → 404 (público)', async () => {
      const res = await http().get('/v1/companies/nope').expect(404);
      expect(res.body.statusCode).toBe(404);
      expect(res.body.path).toBe('/v1/companies/nope');
    });
  });

  /* ─────────────── Paginación por cursor (mantiene M3) ──────────── */

  describe('paginación (Módulo 3)', () => {
    it('GET /job-offers pagina sin perder ni repetir ofertas', async () => {
      await createOffer('Oferta A', 'https://paginacion.com/a');
      await createOffer('Oferta B', 'https://paginacion.com/b');
      await createOffer('Oferta C', 'https://paginacion.com/c');

      const page1 = await http().get('/v1/job-offers?limit=2').expect(200);
      const data1 = (
        page1.body as Envelope<{
          items: unknown[];
          nextCursor: string | null;
        }>
      ).data;
      expect(data1.items).toHaveLength(2);
      expect(data1.nextCursor).toBeTruthy();

      const page2 = await http()
        .get(`/v1/job-offers?limit=2&cursor=${data1.nextCursor}`)
        .expect(200);
      const data2 = (
        page2.body as Envelope<{
          items: unknown[];
          nextCursor: string | null;
        }>
      ).data;
      expect(data2.items).toHaveLength(1);
      expect(data2.nextCursor).toBeNull();

      const titles = [
        ...data1.items.map((it: { title: string }) => it.title),
        ...data2.items.map((it: { title: string }) => it.title),
      ];
      expect(new Set(titles)).toEqual(
        new Set(['Oferta A', 'Oferta B', 'Oferta C']),
      );
    });
  });

  /* ─────────── Notificaciones realtime (WS) + REST (Módulo 8) ────── */

  describe('notificaciones realtime y REST (Módulo 8)', () => {
    let wsSockets: ClientSocket[] = [];

    afterEach(() => {
      for (const socket of wsSockets) socket.disconnect();
      wsSockets = [];
    });

    // El app del e2e vive in-process (supertest). Socket.IO necesita un puerto
    // real: bindeo el mismo servidor HTTP a un puerto efímero solo en este
    // bloque; el resto de la suite no se entera.
    async function listenWs(): Promise<number> {
      await app.listen(0);
      const address = app.getHttpServer().address() as { port: number };
      return address.port;
    }

    function connectWs(port: number, token?: string): Promise<ClientSocket> {
      return new Promise<ClientSocket>((resolve, reject) => {
        const socket = createSocket(`http://127.0.0.1:${port}/notifications`, {
          forceNew: true,
          transports: ['websocket'],
          auth: { token },
        });
        let settled = false;
        const fail = (reason: string) => {
          if (settled) return;
          settled = true;
          socket.disconnect();
          reject(new Error(reason));
        };
        socket.once('connect', () => {
          if (settled) return;
          settled = true;
          socket.off('connect_error');
          resolve(socket);
        });
        // El server rechaza el handshake desconectando el socket inválido,
        // posiblemente DESPUÉS del evento 'connect' del cliente: por eso el
        // listener de disconnect se queda activo hasta que el test resuelve.
        socket.on('connect_error', () => fail('connect_error'));
        socket.on('disconnect', () => fail('disconnect en el handshake'));
      });
    }

    it('rechaza conexiones sin token o con token inválido en el handshake', async () => {
      const port = await listenWs();

      await expect(connectWs(port)).rejects.toThrow();
      await expect(connectWs(port, 'garbage-token')).rejects.toThrow();
    }, 60_000);

    it('el usuario recibe su notificación en tiempo real y otro usuario NO', async () => {
      const port = await listenWs();
      const alice = await sessionFor('user');
      const bob = await sessionFor('user');

      const [aliceSocket, bobSocket] = await Promise.all([
        connectWs(port, alice.accessToken),
        connectWs(port, bob.accessToken),
      ]);
      wsSockets.push(aliceSocket, bobSocket);

      const aliceEvents: unknown[] = [];
      const bobEvents: unknown[] = [];
      aliceSocket.on('notification.created', (payload) =>
        aliceEvents.push(payload),
      );
      bobSocket.on('notification.created', (payload) =>
        bobEvents.push(payload),
      );

      // Dispara el flujo real de M7: match de stack + persistencia + evento
      // de dominio (NotificatonsService emite, el gateway empuja al room).
      await app
        .get(DataSource)
        .query(
          'INSERT INTO profile ("userId", "stack", "yearsOfExperience") VALUES ($1, $2, $3)',
          [alice.user.id, 'typescript,nestjs', 4],
        );
      await app.get(NotificationsService).notifyNewOfferForStack({
        id: crypto.randomUUID(),
        title: 'Senior TypeScript (realtime)',
        stack: ['typescript'],
      });

      await waitForCondition(
        () => Promise.resolve(aliceEvents.length),
        (n) => n >= 1,
        40,
        100,
        'push realtime a Alice',
      );
      await sleep(300);

      expect(aliceEvents).toHaveLength(1);
      expect(bobEvents).toHaveLength(0);
      const payload = aliceEvents[0] as {
        data: { notification: { type: string } };
      };
      expect(payload.data.notification.type).toBe('new_offer');
    }, 60_000);

    it('REST: exige token, lista solo lo propio y respeta ownership al marcar leída', async () => {
      await http().get('/v1/notifications').expect(401);

      const alice = await sessionFor('user');
      const bob = await sessionFor('user');

      await app
        .get(DataSource)
        .query(
          'INSERT INTO profile ("userId", "stack", "yearsOfExperience") VALUES ($1, $2, $3)',
          [alice.user.id, 'typescript,nestjs', 4],
        );
      await app.get(NotificationsService).notifyNewOfferForStack({
        id: crypto.randomUUID(),
        title: 'Oferta REST',
        stack: ['typescript'],
      });

      const list = await http()
        .get('/v1/notifications')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      const items = (list.body as Envelope<Array<Record<string, unknown>>>)
        .data;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((n) => n.userId === alice.user.id)).toBe(true);

      const bobList = await http()
        .get('/v1/notifications')
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(200);
      expect((bobList.body as Envelope<unknown[]>).data).toHaveLength(0);

      const unread = await http()
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      expect((unread.body as Envelope<number>).data).toBe(items.length);

      const firstId = items[0]?.id as string;
      await http()
        .patch(`/v1/notifications/${firstId}/read`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(404);

      const patched = await http()
        .patch(`/v1/notifications/${firstId}/read`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      expect(
        (patched.body as Envelope<{ readAt: unknown }>).data.readAt,
      ).toBeTruthy();

      const unreadAfter = await http()
        .get('/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      expect((unreadAfter.body as Envelope<number>).data).toBe(
        items.length - 1,
      );
    }, 60_000);
  });
});
