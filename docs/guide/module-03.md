# Módulo 3 — Persistencia: PostgreSQL, TypeORM, relaciones y migraciones

> **Estado:** ✅ Completo · **Duración estimada:** 7–10 días
> **Rama de git sugerida:** `module-03-persistence`

## Conceptos clave

- Integración de Nest con un ORM: elegí **TypeORM** porque su integración con Nest es la más nativa (`@nestjs/typeorm`, `TypeOrmModule.forRootAsync()`).
- Entidades y relaciones: `ManyToOne`/`OneToMany` (`Company` → `JobOffer`, `JobOffer` → `Application`), `OneToOne` (`User` → `Profile`) y la **relación de postulación** `User` ↔ `JobOffer`.
- **Migraciones versionadas** vs. `synchronize: true` (nunca en producción — acá solo se usa para resetear el esquema en e2e).
- Patrón **Repository** de Nest detrás de una interfaz (DIP del Módulo 1): el service sigue sin saber que hay una base; se cambió el adaptador en memoria por `typeorm-*.repository.ts`.
- **Transacciones explícitas** para operaciones multi-paso atómicas (cupos de ofertas).

## Lo que se implementó

### 1. Postgres real en Docker, en el puerto `5433`

`docker-compose.yml` levanta `postgres:16-alpine` con healthcheck (`pg_isready`), volumen persistente y mapa de puertos **`5433:5432`** — el `5432` de esta máquina lo ocupa una instalación nativa de PostgreSQL en Windows; esa es la razón del puerto no estándar.

```bash
cp .env.example .env
npm run db:up      # docker compose up -d
npm run db:migration:run
npm run db:seed
```

```bash
# .env
DATABASE_URL=postgresql://jobtrack:jobtrack@localhost:5433/jobtrack?schema=public
```

### 2. Entidades con relaciones por _string_ (detalle ESM + TypeScript)

Las 6 entidades del dominio quedaron decoradas. Un detalle fino que costó resolver: con `emitDecoratorMetadata`, TypeScript emite el `design:type` de cada propiedad **en tiempo de decoración**; con los imports ESM circulares, importar el valor de la clase companion rompe con `Cannot access 'User' before initialization` (TDZ). La solución: las relaciones se declaran **por nombre de entidad** y las clases se importan solo como `type`:

```ts
// users/entities/user.entity.ts
import type { Application } from '../../applications/entities/application.entity.js';

@Entity('user')
export class User {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @OneToMany('application', (application: Application) => application.user)
  applications: Application[];
}
```

- `@OneToMany('job_offer', (offer) => offer.company, { onDelete: 'CASCADE' })`, `@ManyToOne('company', (company) => company.jobOffers)`… — todas con el **nombre de tabla/entidad** como string.
- PKs por `@PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })` — evita depender de la extensión `uuid-ossp`.
- Índices en las columnas que filtran/ordenan: `(postedAt, id)` para la paginación, `status` y `userId` en `Application`, `email` en `User`, `userId` en `Profile`.
- Unicidad real en DB: `UNIQUE(userId, jobOfferId)` en aplicaciones y `UNIQUE(sourceUrl)` en ofertas — son las que garantizan los 409 aunque haya requests concurrentes.

### 3. `synchronize: false` + migraciones versionadas

La conexión corre con `synchronize: false` y `migrationsRun: false`. El esquema vive **solo** en migraciones:

```ts
// src/config/database.ts — opciones compartidas runtime + CLI
export function getDatabaseOptions({
  url,
}: {
  url: string;
}): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ALL_ENTITIES,
    synchronize: false,
    migrationsRun: false,
    poolSize: 10,
    logging: ['error'],
  };
}

// src/database/data-source.ts — punto de entrada del CLI de TypeORM
import 'dotenv/config';
export default new DataSource({
  ...getDatabaseOptions({ url: process.env.DATABASE_URL as string }),
  migrations: ['dist/database/migrations/*.js'],
});
```

La migración inicial se genera desde las entidades y se versiona:

```bash
npm run db:migration:generate   # genera src/database/migrations/1-SchemaInit.ts
npm run db:migration:run        # aplica la migración pendiente
```

`ALL_ENTITIES` se comparte entre runtime (`TypeOrmModule`) y CLI (`data-source.ts`) para que ambos vean exactamente el mismo modelo.

### 4. Puertos async y adaptadores TypeORM

Los puertos del Módulo 1/2 pasaron de síncronos a **promesas**. Los services ahora hacen `await`, y el adaptador en memoria se reemplazó por el de TypeORM (injectando `@InjectRepository(Entity)`):

```ts
// applications/applications.repository.ts (puerto)
export abstract class ApplicationsRepository {
  abstract findAll(): Promise<Application[]>;
  abstract createWithSlotDecrement(data: {...}, jobOfferId: string): Promise<Application>;
  abstract findAllWithJobOfferAndCompany(): Promise<Application[]>;
  // ...
}
```

### 5. Paginación por cursor (keyset) en `GET /job-offers`

Nunca se devuelve la tabla completa: paginación **keyset** sobre `(postedAt, id)` con cursor opaco en base64url.

```ts
// job-offers/job-offers.pagination.ts
export function encodeCursor(postedAt: Date, id: string): string {
  return Buffer.from(`${postedAt.toISOString()}|${id}`).toString('base64url');
}

// decodeCursor() valida y devuelve { postedAt, id } — cursor inválido → 400
```

El service pide `limit + 1` filas: si aparecen más de `limit`, hay siguiente página y se devuelve `nextCursor`; si no, `null`. El DTO acota con `limit` (coerce, default 30, max 100) y `cursor`.

```bash
GET /job-offers?limit=2
→ {"items":[...], "nextCursor":"MjAyNS0wMS0xNVQxMDowMDowMC4wMDBafDZkYjk... "}
GET /job-offers?limit=2&cursor=MjAyNS0wMS0xNVQ...   # siguiente página
```

### 6. Reto entrevista — el problema N+1 en `GET /applications`

El anti-patrón clásico: iterar cada aplicación y consultar su oferta y empresa por separado → **1 + 2N queries**. La solución es UNA query con joins (`relations: { jobOffer: { company: true } }`), donde la base devuelve las filas desnormalizadas y TypeORM reensambla el árbol en memoria.

`npm run db:n1` lo demuestra con un logger que **cuenta queries reales** contra la base:

```bash
Reto N+1: el mismo payload por dos caminos
-----------------------------------------------
N+1 (naive):   1 aplicaciones, 3 queries
Eager (joins): 1 aplicaciones, 1 queries
-----------------------------------------------
Diferencia: 2 queries menos.
```

> La demo usa `manager.find(Application, { relations: { jobOffer: { company: true } } })` — el mismo `find` sin `relations` no precarga nada, y cada hecho de la lista dispara sus propias queries.

### 7. Reto entrevista — operación transaccional: postular + decrementar cupos

Crear una `Application` y descontar un `slots` de la `JobOffer` en la **misma transacción** (todo-o-nada). El decremento además es **atómico y condicional** — `UPDATE ... WHERE id = :id AND slots > 0` — así dos requests concurrentes no pueden sobrevender:

```ts
// typeorm-applications.repository.ts
return await this.dataSource.transaction(async (manager) => {
  const result = await manager
    .createQueryBuilder()
    .update(JobOffer)
    .set({ slots: () => 'slots - 1' })
    .where('id = :id AND slots > 0', { id: jobOfferId })
    .execute();

  if ((result.affected ?? 0) === 0) {
    throw new SlotsExhaustedException(jobOfferId); // 409 si no hay cupos
  }

  const application = manager.create(Application, { userId, jobOfferId });
  return manager.save(application);
});
```

- Sin cupos → `SlotsExhaustedException` (**409**, no 500).
- El `UNIQUE(userId, jobOfferId)` es la red de seguridad para carreras: si dos aplicaciones del mismo usuario llegan a la vez, el `23505` de la base se mapea a `DuplicateApplicationException` (**409**).
- La oferta inexistente se distingue del caso "sin cupos" → `JobOfferNotFoundException` (404).

### 8. Guard de UUID → 404 (evitar el 500 de PostgreSQL)

Un `id` que no sea UUID en un path (`GET /companies/asdf`) hacía que PostgreSQL lanzara `22P02: invalid input syntax for type uuid` → 500. Los adapters lo resuelven antes de tocar la base:

```ts
// common/utils/is-uuid.ts
override async findById(id: string): Promise<Company | null> {
  if (!isUuid(id)) return null;   // nunca llega un string inválido a la DB
  return this.companyRepository.findOneBy({ id });
}
```

### 9. Health check con la base

El health check pasa a incluir un ping real a Postgres vía `TypeOrmHealthIndicator`:

```bash
GET /health
→ {"status":"ok","info":{"database":{"status":"up"}, ...}}
```

## Mejores prácticas aplicadas

- ✅ TypeORM detrás de **puertos async** — el service no sabe si hay ORM, SQL crudo o un mock.
- ✅ `synchronize: false` en runtime; esquema solo por **migraciones versionadas**.
- ✅ **Pool** explícito (`poolSize: 10`) y logging solo de errores.
- ✅ Seeds de datos de desarrollo **separados** de las migraciones (`src/database/seed-data.ts` compartido con las demos).
- ✅ Relaciones con nombre-por-entidad para convivir con **ESM + `emitDecoratorMetadata`** (sin ciclos corruptos en tiempo de decoración).
- ✅ Unicidad y FK **en la base**, no solo en el service (escenario concurrente).
- ✅ Paginación **keyset/keyset por cursor** en listas que crecen.
- ✅ N+1 resuelto con joins y **medido** con un contador de queries real.
- ✅ Transacción `todo-o-nada` con decremento condicional atómico.

## Verificación del entregable

```bash
npm run build                 # compila sin errores
npm run lint                  # 0 warnings, 0 errors
npm test                      # 25 tests unitarios → all passed
npm run test:e2e              # 14 tests e2e contra Postgres real → all passed
npm run db:migration:run      # migración SchemaInit aplicada
npm run db:seed               # { companies: 3, offers: 4, users: 1, applications: 1 }
npm run db:n1                 # naive 3 queries vs eager 1 query
```

```bash
curl localhost:3000/health                # → database: up
curl 'localhost:3000/job-offers?limit=2'  # → items + nextCursor
curl localhost:3000/applications          # → jerarquía anidada en 1 query
```

Anterior: [Módulo 2](/guide/module-02) · Siguiente: [Módulo 4](/guide/module-04)
