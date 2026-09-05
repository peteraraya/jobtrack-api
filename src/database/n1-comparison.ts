import 'dotenv/config';
import { DataSource } from 'typeorm';
import { getDatabaseOptions } from '../config/database.js';
import { Application } from '../modules/applications/entities/application.entity.js';
import { Company } from '../modules/companies/entities/company.entity.js';
import { JobOffer } from '../modules/job-offers/entities/job-offer.entity.js';

/**
 * Demo del problema N+1 para entrevistas.
 *
 * Es el MISMO resultado (aplicaciones + oferta + empresa) por dos caminos:
 *   1. naive: un find por aplicación (1 + 2N queries a la base).
 *   2. eager: una sola query con dos joins.
 *
 * Uso: npm run db:n1  (requiere migraciones corridas)
 */
class QueryCounterLogger {
  count = 0;

  logQuery(): void {
    this.count++;
  }

  logQueryError(): void {}
  logQuerySlow(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

async function main(): Promise<void> {
  const baseOptions = getDatabaseOptions({
    url: process.env.DATABASE_URL as string,
  });

  const logger = new QueryCounterLogger();
  const dataSource = new DataSource({ ...baseOptions, logger });
  await dataSource.initialize();

  try {
    const { seedDatabase } = await import('./seed-data.js');
    await seedDatabase(dataSource.manager);

    logger.count = 0;
    const naiveRows = await naiveWithDetails(dataSource);
    const naiveQueries = logger.count;

    logger.count = 0;
    const eagerRows = await eagerWithDetails(dataSource);
    const eagerQueries = logger.count;

    console.log('Reto N+1: el mismo payload por dos caminos');
    console.log('----------------------------------------------');
    console.log(
      `N+1 (naive):   ${naiveRows} aplicaciones, ${naiveQueries} queries`,
    );
    console.log(
      `Eager (joins): ${eagerRows} aplicaciones, ${eagerQueries} queries`,
    );
    console.log('----------------------------------------------');
    console.log(`Diferencia: ${naiveQueries - eagerQueries} queries menos.`);
    console.log('Por qué: leftJoinAndSelect trae las N filas desnormalizadas');
    console.log('en UNA respuesta de red y TypeORM reensambla el árbol en');
    console.log('memoria — no hay N+1 aunque la lista crezca.');
  } finally {
    await dataSource.destroy();
  }
}

async function naiveWithDetails(dataSource: DataSource): Promise<number> {
  // Anti-patrón: con manager.find() sin *relations* NINGUNA relación se
  // precarga — cada hecho de la lista dispara sus propias queries (N+1).
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
  // Maneira correcta: una query con joins pide toda la jerarquía de una vez.
  const applications = await dataSource.manager.find(Application, {
    relations: { jobOffer: { company: true } },
    order: { createdAt: 'DESC' },
  });
  return applications.length;
}

main().catch((error) => {
  console.error('[n1-comparison] failed', error);
  process.exitCode = 1;
});
