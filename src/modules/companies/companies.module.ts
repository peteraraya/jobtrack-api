import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompaniesRepository } from './companies.repository.js';
import { TypeOrmCompaniesRepository } from './typeorm-companies.repository.js';
import { Company } from './entities/company.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [CompaniesController],
  providers: [
    CompaniesService,
    { provide: CompaniesRepository, useClass: TypeOrmCompaniesRepository },
  ],
  exports: [CompaniesService],
})
export class CompaniesModule {}
