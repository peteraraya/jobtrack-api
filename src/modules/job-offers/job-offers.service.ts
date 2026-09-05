import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { CompaniesService } from '../companies/companies.service.js';
import { JobOffersRepository } from './job-offers.repository.js';
import type { CreateJobOfferData } from './job-offers.repository.js';
import { JobOffer } from './entities/job-offer.entity.js';
import { CreateJobOfferDto } from './dto/create-job-offer.dto.js';
import { UpdateJobOfferDto } from './dto/update-job-offer.dto.js';
import { JOB_SOURCE_CONFIG } from './job-source.config.js';
import type { JobSourceConfig } from './job-source.config.js';
import { JobOfferNotFoundException } from './exceptions/job-offer-not-found.exception.js';
import {
  Paginated,
  decodeCursor,
  encodeCursor,
} from './job-offers.pagination.js';

@Injectable()
export class JobOffersService {
  constructor(
    // Puerto desacoplado del ORM (DIP).
    private readonly jobOffersRepository: JobOffersRepository,
    // Token custom: el service no conoce de dónde sale la config.
    @Inject(JOB_SOURCE_CONFIG)
    private readonly jobSourceConfig: JobSourceConfig,
    // Service de otro módulo, reutilizado vía exports/imports.
    private readonly companiesService: CompaniesService,
  ) {}

  async findAll(limit: number, cursor?: string): Promise<Paginated<JobOffer>> {
    const after = cursor !== undefined ? decodeCursor(cursor) : null;

    // Al pedir limit+1 sabemos si hay más páginas sin una query extra.
    const items = await this.jobOffersRepository.findPage(limit + 1, after);
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    // El cursor solo existe si hay página siguiente.
    const last = hasMore ? page[page.length - 1] : undefined;
    const nextCursor =
      last !== undefined ? encodeCursor(last.postedAt, last.id) : null;

    return { items: page, nextCursor };
  }

  async findById(id: string): Promise<JobOffer> {
    const offer = await this.jobOffersRepository.findById(id);
    if (!offer) {
      throw new JobOfferNotFoundException(id);
    }
    return offer;
  }

  async create(dto: CreateJobOfferDto): Promise<JobOffer> {
    await this.companiesService.findById(dto.companyId);

    const source = this.extractSource(dto.sourceUrl);
    await this.enforceSourceLimit(source);

    return this.jobOffersRepository.create({ ...dto, source });
  }

  /**
   * Módulo 7: upsert para el pipeline de scraping. No pasa por el límite por
   * fuente (eso aplica al alta manual) y es IDEMPOTENTE: reintentar el mismo
   * job actualiza en vez de duplicar. `created` dispara (o no) las
   * notificaciones de perfil match.
   */
  async upsertFromSource(data: CreateJobOfferData): Promise<{
    offer: JobOffer;
    created: boolean;
  }> {
    return this.jobOffersRepository.upsertFromSource(data);
  }

  async update(id: string, dto: UpdateJobOfferDto): Promise<JobOffer> {
    if (dto.companyId !== undefined) {
      await this.companiesService.findById(dto.companyId);
    }
    const updated = await this.jobOffersRepository.update(id, dto);
    if (!updated) {
      throw new JobOfferNotFoundException(id);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.jobOffersRepository.delete(id);
    if (!deleted) {
      throw new JobOfferNotFoundException(id);
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
    // Las ofertas de fuentes no permitidas se asumen como carga manual.
    return isScrapedSource ? host : 'manual';
  }

  private async enforceSourceLimit(source: string): Promise<void> {
    if (source === 'manual') return;

    const current = await this.jobOffersRepository.countBySource(source);
    const { maxResultsPerSource } = this.jobSourceConfig;

    if (current >= maxResultsPerSource) {
      throw new ConflictException(
        `Source "${source}" already has ${current} job offers ` +
          `(limit: ${maxResultsPerSource})`,
      );
    }
  }
}
