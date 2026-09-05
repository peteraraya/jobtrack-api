# Código fuente — Módulo 1

Código real del proyecto al cierre del Módulo 1. Las entidades, DTOs y tests están en `src/` — aquí se referencian los archivos clave navegables sin salir de la guía.

## `src/modules/companies/companies.repository.ts`

El **puerto** (interfaz abstracta). El service depende de esta forma, no de la implementación.

```ts
import { Company } from './entities/company.entity.js';

export abstract class CompaniesRepository {
  abstract findAll(): Company[];
  abstract findById(id: string): Company | null;
  abstract create(data: {
    name: string;
    website?: string;
    location?: string;
  }): Company;
  abstract update(
    id: string,
    data: { name?: string; website?: string; location?: string },
  ): Company | null;
  abstract delete(id: string): boolean;
}
```

## `src/modules/companies/in-memory-companies.repository.ts`

El **adaptador**. Se reemplazará en el Módulo 3 por una implementación con el ORM **sin tocar el service** (DIP).

```ts
import { Injectable } from '@nestjs/common';
import { Company } from './entities/company.entity.js';
import { CompaniesRepository } from './companies.repository.js';

@Injectable()
export class InMemoryCompaniesRepository extends CompaniesRepository {
  private readonly companies: Company[] = [];

  findAll(): Company[] {
    return this.companies;
  }

  findById(id: string): Company | null {
    return this.companies.find((company) => company.id === id) ?? null;
  }

  create(data: { name: string; website?: string; location?: string }): Company {
    const company = new Company(data);
    this.companies.push(company);
    return company;
  }

  update(
    id: string,
    data: { name?: string; website?: string; location?: string },
  ): Company | null {
    const company = this.findById(id);
    if (!company) return null;

    if (data.name !== undefined) company.name = data.name;
    if (data.website !== undefined) company.website = data.website;
    if (data.location !== undefined) company.location = data.location;
    return company;
  }

  delete(id: string): boolean {
    const index = this.companies.findIndex((company) => company.id === id);
    if (index === -1) return false;
    this.companies.splice(index, 1);
    return true;
  }
}
```

## `src/modules/companies/companies.module.ts`

```ts
import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompaniesRepository } from './companies.repository.js';
import { InMemoryCompaniesRepository } from './in-memory-companies.repository.js';

@Module({
  controllers: [CompaniesController],
  providers: [
    CompaniesService,
    { provide: CompaniesRepository, useClass: InMemoryCompaniesRepository },
  ],
  exports: [CompaniesService],
})
export class CompaniesModule {}
```

## `src/modules/job-offers/job-source.config.ts`

**Reto entrevista:** token custom + factory provider desacoplado del `ConfigService`.

```ts
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration.js';

export const JOB_SOURCE_CONFIG = 'JOB_SOURCE_CONFIG' as const;

export interface JobSourceConfig {
  maxResultsPerSource: number;
  sources: string[];
}

export function createJobSourceConfig(
  configService: ConfigService<Env, true>,
): JobSourceConfig {
  const raw = configService.get('JOB_SOURCES', { infer: true });
  const sources = raw
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter((source) => source.length > 0);

  return {
    maxResultsPerSource: configService.get('JOB_MAX_RESULTS_PER_SOURCE', {
      infer: true,
    }),
    sources,
  };
}
```

## `src/modules/job-offers/job-offers.service.ts`

```ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CompaniesService } from '../companies/companies.service.js';
import { JobOffersRepository } from './job-offers.repository.js';
import { JobOffer } from './entities/job-offer.entity.js';
import { CreateJobOfferDto } from './dto/create-job-offer.dto.js';
import { UpdateJobOfferDto } from './dto/update-job-offer.dto.js';
import { JOB_SOURCE_CONFIG } from './job-source.config.js';
import type { JobSourceConfig } from './job-source.config.js';

@Injectable()
export class JobOffersService {
  constructor(
    private readonly jobOffersRepository: JobOffersRepository,
    @Inject(JOB_SOURCE_CONFIG)
    private readonly jobSourceConfig: JobSourceConfig,
    private readonly companiesService: CompaniesService,
  ) {}

  findAll(): JobOffer[] {
    return this.jobOffersRepository.findAll();
  }

  findById(id: string): JobOffer {
    const offer = this.jobOffersRepository.findById(id);
    if (!offer) {
      throw new NotFoundException(`Job offer with id "${id}" not found`);
    }
    return offer;
  }

  create(dto: CreateJobOfferDto): JobOffer {
    this.companiesService.findById(dto.companyId);

    const source = this.extractSource(dto.sourceUrl);
    this.enforceSourceLimit(source);

    return this.jobOffersRepository.create({ ...dto, source });
  }

  update(id: string, dto: UpdateJobOfferDto): JobOffer {
    if (dto.companyId !== undefined) {
      this.companiesService.findById(dto.companyId);
    }
    const updated = this.jobOffersRepository.update(id, dto);
    if (!updated) {
      throw new NotFoundException(`Job offer with id "${id}" not found`);
    }
    return updated;
  }

  delete(id: string): void {
    const deleted = this.jobOffersRepository.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Job offer with id "${id}" not found`);
    }
  }

  private extractSource(sourceUrl: string): string {
    let host: string;
    try {
      host = new URL(sourceUrl).hostname;
    } catch {
      throw new BadRequestException(
        `Invalid sourceUrl "${sourceUrl}": must be a valid URL`,
      );
    }

    const isScrapedSource = this.jobSourceConfig.sources.includes(host);
    return isScrapedSource ? host : 'manual';
  }

  private enforceSourceLimit(source: string): void {
    if (source === 'manual') return;

    const current = this.jobOffersRepository.countBySource(source);
    const { maxResultsPerSource } = this.jobSourceConfig;

    if (current >= maxResultsPerSource) {
      throw new ConflictException(
        `Source "${source}" already has ${current} job offers ` +
          `(limit: ${maxResultsPerSource})`,
      );
    }
  }
}
```

## `src/modules/job-offers/job-offers.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompaniesModule } from '../companies/companies.module.js';
import { JobOffersController } from './job-offers.controller.js';
import { JobOffersService } from './job-offers.service.js';
import { JobOffersRepository } from './job-offers.repository.js';
import { InMemoryJobOffersRepository } from './in-memory-job-offers.repository.js';
import {
  createJobSourceConfig,
  JOB_SOURCE_CONFIG,
} from './job-source.config.js';

@Module({
  imports: [CompaniesModule],
  controllers: [JobOffersController],
  providers: [
    JobOffersService,
    { provide: JobOffersRepository, useClass: InMemoryJobOffersRepository },
    {
      provide: JOB_SOURCE_CONFIG,
      inject: [ConfigService],
      useFactory: createJobSourceConfig,
    },
  ],
})
export class JobOffersModule {}
```

## Tests unitarios

`src/modules/companies/companies.service.spec.ts` (6 tests) y `src/modules/job-offers/job-offers.service.spec.ts` (9 tests) — total **15 tests** que cubren: caso feliz, `NotFoundException`, `ConflictException` (límite de fuente), `BadRequestException` (URL inválida) y validación de empresa inexistente.
