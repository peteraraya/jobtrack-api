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
