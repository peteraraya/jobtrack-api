import { EntityManager } from 'typeorm';
import { hashPassword } from '../modules/auth/crypto.js';
import { Application } from '../modules/applications/entities/application.entity.js';
import { Company } from '../modules/companies/entities/company.entity.js';
import { JobOffer } from '../modules/job-offers/entities/job-offer.entity.js';
import { User } from '../modules/users/entities/user.entity.js';

/**
 * Pobla datos de ejemplo (dev / demos). Idempotente: vacía las tablas de
 * negocio y las vuelve a crear. Compartido por db:seed y db:n1.
 */
export async function seedDatabase(manager: EntityManager): Promise<void> {
  await manager.query(
    'TRUNCATE TABLE application, job_offer, company, profile, notification, "user" RESTART IDENTITY CASCADE',
  );

  const [chipilab, acme, remotty] = await manager.save([
    new Company({
      name: 'Chipilab',
      website: 'https://chipilab.dev',
      location: 'Santiago',
    }),
    new Company({
      name: 'Acme Style',
      website: 'https://acme.style',
      location: 'Remoto',
    }),
    new Company({
      name: 'Remotty',
      website: 'https://remotty.com',
      location: 'Remoto',
    }),
  ]);

  await manager.save([
    new JobOffer({
      companyId: chipilab.id,
      title: 'Senior NestJS Developer',
      description: 'API de alta concurrencia con TypeScript.',
      location: 'Santiago (híbrido)',
      stack: ['NestJS', 'TypeORM', 'PostgreSQL'],
      sourceUrl: 'https://linkedin.com/jobs/chipilab-senior-nestjs',
      source: 'linkedin.com',
      slots: 2,
    }),
    new JobOffer({
      companyId: chipilab.id,
      title: 'Backend Engineer (Node)',
      description: 'Servicios con Node.js y eventos.',
      location: 'Santiago',
      stack: ['Node.js', 'TypeScript'],
      sourceUrl: 'https://computrabajo.com/jobs/chipilab-backend',
      source: 'computrabajo.com',
      slots: 3,
    }),
    new JobOffer({
      companyId: acme.id,
      title: 'Full-stack TypeScript',
      description: 'Stack completo sobre NestJS + React.',
      location: 'Remoto',
      stack: ['NestJS', 'React', 'PostgreSQL'],
      sourceUrl: 'https://acme.style/careers/fullstack-ts',
      source: 'manual',
      slots: 1,
    }),
    new JobOffer({
      companyId: remotty.id,
      title: 'Platform Engineer',
      description: 'Infraestructura como código y observabilidad.',
      location: 'Remoto',
      stack: ['Docker', 'Terraform', 'Grafana'],
      sourceUrl: 'https://remotty.com/careers/platform',
      source: 'manual',
      slots: 3,
    }),
  ]);

  // Módulo 4: contraseñas reales (bcrypt) para poder loguearse en local.
  // demo@jobtrack.dev / Demo1234!   ·   admin@jobtrack.dev / Admin1234!
  const demoUser = await manager.save(
    new User({
      email: 'demo@jobtrack.dev',
      passwordHash: await hashPassword('Demo1234!'),
      role: 'user',
    }),
  );

  await manager.save(
    new User({
      email: 'admin@jobtrack.dev',
      passwordHash: await hashPassword('Admin1234!'),
      role: 'admin',
    }),
  );

  const firstOffer = await manager.findOneByOrFail(JobOffer, {
    sourceUrl: 'https://linkedin.com/jobs/chipilab-senior-nestjs',
  });

  // Una postulación de ejemplo. El decremento de slots transaccional ocurre
  // al aplicar vía la API — el seed crea el comprobante directo.
  await manager.save(
    new Application({ userId: demoUser.id, jobOfferId: firstOffer.id }),
  );
}
