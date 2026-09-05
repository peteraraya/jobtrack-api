import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobOffersModule } from '../job-offers/job-offers.module.js';
import { ApplicationsController } from './applications.controller.js';
import { ApplicationsService } from './applications.service.js';
import { ApplicationsRepository } from './applications.repository.js';
import { TypeOrmApplicationsRepository } from './typeorm-applications.repository.js';
import { Application } from './entities/application.entity.js';

/**
 * Módulo de aplicaciones. Implementa los retos:
 * - Módulo 2: DuplicateApplicationException (409 al postular dos veces).
 * - Módulo 3: crea la postulación y decrementa los cupos en UNA transacción
 *   (todo-o-nada) y resuelve el N+1 en GET /applications con joins.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Application]), JobOffersModule],
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    {
      provide: ApplicationsRepository,
      useClass: TypeOrmApplicationsRepository,
    },
  ],
})
export class ApplicationsModule {}
