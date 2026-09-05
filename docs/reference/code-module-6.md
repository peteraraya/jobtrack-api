# Código fuente — Módulo 6

Código real del proyecto al cierre del Módulo 6: la pirámide de testing (unit + integration + e2e) y el CI como gate.

## `vitest.config.ts` (unit — ahora restringido a `src/`)

Cada runner incluye solo "su capa". El unit config ya no atrapa los tests de `test/`:

```ts
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    // Unit tests viven junto al fuente que prueban. Los integration live en
    // test/integration (config aparte) y los e2e en test/*.e2e-spec.ts.
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./test/env.setup.ts'],
  },
});
```

## `vitest.config.integration.ts` (middle de la pirámide)

```ts
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.integration-spec.ts'],
    setupFiles: ['./test/env.setup.ts'],
    // La DB real se comparte entre integration tests: secuencial y estable.
    fileParallelism: false,
  },
});
```

## `test/integration/applications.integration-spec.ts`

Services + Repositories + **Postgres real**, sin HTTP. Compila el `AppModule` completo y dropea/recrea el esquema por test.

```ts
describe('applications (integration) — service + repo + Postgres real', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let applicationsService: ApplicationsService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    await dataSource.synchronize(true);
    applicationsService = app.get(ApplicationsService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('apply() crea la postulación y DECREMENTA los cupos en una tx', async () => {
    const user = /* ... */;
    const offer = await seedOffer(3);
    const applied = await applicationsService.apply(user.id, {
      jobOfferId: offer.id,
    });
    expect(applied.status).toBe('applied');
    const reloaded = await offerRepo.findOneBy({ id: offer.id });
    expect(reloaded?.slots).toBe(2);
  });

  it('apply() dos veces a la misma oferta → DuplicateApplicationException', async () => {
    await applicationsService.apply(user.id, { jobOfferId: offer.id });
    await expect(
      applicationsService.apply(user.id, { jobOfferId: offer.id }),
    ).rejects.toThrow(DuplicateApplicationException);
  });

  it('apply() a una oferta inexistente → JobOfferNotFoundException (y la tx hace rollback)', async () => {
    await expect(
      applicationsService.apply(user.id, { jobOfferId: crypto.randomUUID() }),
    ).rejects.toThrow(JobOfferNotFoundException);
    // Rollback: no queda fila a medias
    const apps = await dataSource.getRepository('application').find({
      where: { userId: user.id },
    });
    expect(apps).toHaveLength(0);
  });
});
```

### Reto N+1 — contar queries con `pg.Client.prototype.query`

La operación de lectura debe emitir **una sola `SELECT`** con los joins. Se intercepta el driver (punto de paso único de todas las queries, incluidas las de transacciones) y se cuenta. Si volviera el N+1, el resultado seguiría siendo correcto pero este test **fallaría**:

```ts
const queries: string[] = [];
const original = pg.Client.prototype.query as unknown as (
  ...args: unknown[]
) => unknown;
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

  const all = await applicationsService.findAllWithDetails();
  const selects = queries.filter((q) => /^\s*SELECT/i.test(q));

  expect(all).toHaveLength(3);
  expect(all.every((it) => it.jobOffer && it.jobOffer.company?.name)).toBe(
    true,
  );
  expect(selects).toHaveLength(1); // Reto N+1
} finally {
  pg.Client.prototype.query = original;
}
```

## `test/app.e2e-spec.ts` — flujo completo de auth

Encadena el recorrido completo en un solo test (lo que antes estaba picado en casos individuales):

```ts
it('flujo completo (M6): registro → login → me → 401 sin token → 403 como user → 201 como admin', async () => {
  // 1) Registro → role=user + tokens
  const registered = (
    await http()
      .post('/auth/register')
      .send({
        email: `flow-${crypto.randomUUID()}@jobtrack.dev`,
        password: PASSWORD,
      })
      .expect(201)
  ).body.data as Session;
  expect(registered.user.role).toBe('user');

  // 2) Login con esas credenciales
  const session = (
    await http()
      .post('/auth/login')
      .send({ email: registered.user.email, password: PASSWORD })
      .expect(201)
  ).body.data as Session;

  // 3) /auth/me con token → usuario autenticado
  await http()
    .get('/auth/me')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .expect(200);

  // 4) Sin token → 401
  await http().get('/auth/me').expect(401);

  // 5) user → /companies → 403 (RBAC)
  await http()
    .post('/companies')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .send({ name: 'Prohibited' })
    .expect(403);

  // 6) admin → /companies → 201
  const admin = await sessionFor('admin');
  await http()
    .post('/companies')
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send({ name: 'Allowed' })
    .expect(201);
});
```

## `.github/workflows/ci.yml` (gate obligatorio en cada PR)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: lint + build + tests (pirámide)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: jobtrack
          POSTGRES_PASSWORD: jobtrack
          POSTGRES_DB: jobtrack
        ports:
          # El app espera la DB en 5433 (igual que el compose local).
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U jobtrack"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://jobtrack:jobtrack@localhost:5433/jobtrack?schema=public
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci --legacy-peer-deps
      - run: npm run lint # 0 warnings, 0 errors
      - run: npm run build # typecheck + nest build
      - run: npm test # unit
      - run: npm run test:integration # con el service container
      - run: npm run test:e2e # con el service container
```

## Scripts nuevos en `package.json`

```json
"test:integration": "vitest run --config ./vitest.config.integration.ts",
```
