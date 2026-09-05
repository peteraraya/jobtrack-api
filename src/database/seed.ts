import 'dotenv/config';
import { DataSource } from 'typeorm';
import { getDatabaseOptions } from '../config/database.js';
import { Application } from '../modules/applications/entities/application.entity.js';
import { Company } from '../modules/companies/entities/company.entity.js';
import { JobOffer } from '../modules/job-offers/entities/job-offer.entity.js';
import { User } from '../modules/users/entities/user.entity.js';
import { seedDatabase } from './seed-data.js';

/**
 * Seed de desarrollo. Ejecutar después de correr las migraciones:
 *   npm run db:seed
 * Es idempotente: vacía las tablas de negocio y las vuelve a poblar.
 */
async function main(): Promise<void> {
  const dataSource = new DataSource(
    getDatabaseOptions({ url: process.env.DATABASE_URL as string }),
  );
  await dataSource.initialize();

  try {
    await seedDatabase(dataSource.manager);

    const [offers, companies, users, applications] = await Promise.all([
      dataSource.manager.count(JobOffer),
      dataSource.manager.count(Company),
      dataSource.manager.count(User),
      dataSource.manager.count(Application),
    ]);

    console.log('[seed] ok', { companies, offers, users, applications });
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error('[seed] failed', error);
  process.exitCode = 1;
});
