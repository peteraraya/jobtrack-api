import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompaniesModule } from '../companies/companies.module.js';
import { JobOffersController } from './job-offers.controller.js';
import { JobOffersService } from './job-offers.service.js';
import { JobOffersRepository } from './job-offers.repository.js';
import { TypeOrmJobOffersRepository } from './typeorm-job-offers.repository.js';
import { JobOffer } from './entities/job-offer.entity.js';
import {
  createJobSourceConfig,
  JOB_SOURCE_CONFIG,
} from './job-source.config.js';

/**
 * Módulo de job-offers. Demuestra:
 * - imports/exports: reutiliza CompaniesService de CompaniesModule y EXPONE
 *   JobOffersService para que ApplicationsModule lo consuma.
 * - factory provider: JOB_SOURCE_CONFIG se resuelve leyendo ConfigService
 *   en el módulo (el service solo ve la "forma" JobSourceConfig).
 * - DIP: JobOffersService depende de la interfaz JobOffersRepository,
 *   implementada con TypeORM (Módulo 3) sin tocar el service.
 */
@Module({
  imports: [TypeOrmModule.forFeature([JobOffer]), CompaniesModule],
  controllers: [JobOffersController],
  providers: [
    JobOffersService,
    { provide: JobOffersRepository, useClass: TypeOrmJobOffersRepository },
    {
      provide: JOB_SOURCE_CONFIG,
      inject: [ConfigService],
      useFactory: createJobSourceConfig,
    },
  ],
  exports: [JobOffersService],
})
export class JobOffersModule {}
