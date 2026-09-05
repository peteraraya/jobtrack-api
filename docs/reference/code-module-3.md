# Código fuente — Módulo 3

Código real del proyecto al cierre del Módulo 3: persistencia con PostgreSQL y TypeORM.

## `src/config/database.ts`

Opciones de conexión compartidas entre el runtime (`TypeOrmModule`) y el CLI de TypeORM (`data-source.ts`). `synchronize: false` y migraciones por archivos versionados.

```ts
import type { DataSourceOptions } from 'typeorm';
import { Application } from '../modules/applications/entities/application.entity.js';
import { Company } from '../modules/companies/entities/company.entity.js';
import { JobOffer } from '../modules/job-offers/entities/job-offer.entity.js';
import { Notification } from '../modules/notifications/entities/notification.entity.js';
import { Profile } from '../modules/profiles/entities/profile.entity.js';
import { User } from '../modules/users/entities/user.entity.js';

export const ALL_ENTITIES = [
  Company,
  JobOffer,
  Application,
  User,
  Profile,
  Notification,
];

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
    // Pool explícito: en producción se ajusta a la carga esperada.
    poolSize: 10,
    logging: ['error'],
  };
}
```

## `src/database/data-source.ts`

Punto de entrada del CLI de migraciones. Loguea las entidades del mismo `ALL_ENTITIES` y busca migraciones en el build (`dist`).

```ts
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { getDatabaseOptions } from '../config/database.js';

export default new DataSource({
  ...getDatabaseOptions({ url: process.env.DATABASE_URL as string }),
  migrations: ['dist/database/migrations/*.js'],
});
```

## `src/modules/users/entities/user.entity.ts`

Relaciones **por nombre de entidad** como string + `import type` de la clase companion. Evita el error TDZ (`Cannot access 'User' before initialization`) que dispara `emitDecoratorMetadata` con imports ESM circulares.

```ts
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

## `src/modules/applications/typeorm-applications.repository.ts`

Adaptador TypeORM del puerto `ApplicationsRepository`. Contiene los dos retos: la query con joins (N+1) y la transacción con decremento condicional de cupos.

```ts
override async findAllWithJobOfferAndCompany(): Promise<Application[]> {
  // Reto N+1: UNA query con joins. Sin este indicador, el getMany() traería
  // 1 + N queries (una por cada aplicación y su oferta/empresa).
  return this.applicationRepository.find({
    relations: { jobOffer: { company: true } },
    order: { createdAt: 'DESC' },
  });
}

override async createWithSlotDecrement(
  data: { userId: string; jobOfferId: string },
  jobOfferId: string,
): Promise<Application> {
  try {
    return await this.dataSource.transaction(async (manager) => {
      // Decremento atómico y condicional: solo descuenta si quedan cupos.
      const result = await manager
        .createQueryBuilder()
        .update(JobOffer)
        .set({ slots: () => 'slots - 1' })
        .where('id = :id AND slots > 0', { id: jobOfferId })
        .execute();

      if ((result.affected ?? 0) === 0) {
        const offerExists = await manager.existsBy(JobOffer, {
          id: jobOfferId,
        });
        if (!offerExists) {
          throw new JobOfferNotFoundException(jobOfferId);
        }
        throw new SlotsExhaustedException(jobOfferId);
      }

      const application = manager.create(Application, {
        userId: data.userId,
        jobOfferId,
        status: ApplicationStatus.Applied,
      });
      return manager.save(application);
    });
  } catch (error) {
    // Red de seguridad para carreras: si dos aplicaciones del mismo usuario
    // llegan a la vez, la CHECK UNIQUE de la base dispara 409.
    if (isUniqueViolation(error)) {
      throw new DuplicateApplicationException(data.userId, jobOfferId);
    }
    throw error;
  }
}
```

## `src/modules/job-offers/job-offers.pagination.ts`

Paginación keyset por cursor. El cliente nunca ve el formato: solo reenvía `nextCursor`.

```ts
export function encodeCursor(postedAt: Date, id: string): string {
  return Buffer.from(`${postedAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): DateCursor {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = raw.lastIndexOf('|');
    const id = raw.slice(separatorIndex + 1);
    const postedAt = new Date(raw.slice(0, separatorIndex));
    if (!id || Number.isNaN(postedAt.getTime())) {
      throw new Error('Invalid cursor payload');
    }
    return { postedAt, id };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
```

## `src/database/n1-comparison.ts`

Demo del problema N+1 contando **queries reales** a la base con un logger custom. Mismo payload por dos caminos: naive (1 + 2N) vs. eager (1 con joins).

```ts
class QueryCounterLogger {
  count = 0;
  logQuery(): void {
    this.count++;
  }
  // ... resto del contrato Logger vacío ...
}

async function naiveWithDetails(dataSource: DataSource): Promise<number> {
  const applications = await dataSource.manager.find(Application, {
    order: { createdAt: 'DESC' },
  });
  let rows = 0;
  for (const application of applications) {
    const offer = await dataSource.manager.findOneBy(JobOffer, {
      id: application.jobOfferId,
    });
    if (offer) {
      await dataSource.manager.findOneBy(Company, { id: offer.companyId });
      rows++;
    }
  }
  return rows;
}

async function eagerWithDetails(dataSource: DataSource): Promise<number> {
  const applications = await dataSource.manager.find(Application, {
    relations: { jobOffer: { company: true } },
    order: { createdAt: 'DESC' },
  });
  return applications.length;
}
```

```bash
npm run db:n1
# N+1 (naive):   1 aplicaciones, 3 queries
# Eager (joins): 1 aplicaciones, 1 queries
```

## `src/common/utils/is-unique-violation.ts`

Detecta violación de constraint único (`23505`) para mapearla a 409 en vez de 500, incluso bajo carreras concurrentes.

```ts
const PG_UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code === PG_UNIQUE_VIOLATION;
  }
  return false;
}
```
