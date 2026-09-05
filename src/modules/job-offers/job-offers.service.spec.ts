import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CompaniesService } from '../companies/companies.service.js';
import { JobOffersService } from './job-offers.service.js';
import { JobOffersRepository } from './job-offers.repository.js';
import { JOB_SOURCE_CONFIG } from './job-source.config.js';
import type { JobSourceConfig } from './job-source.config.js';
import { JobOfferNotFoundException } from './exceptions/job-offer-not-found.exception.js';

describe('JobOffersService', () => {
  let service: JobOffersService;
  let repository: JobOffersRepository;
  let companiesService: CompaniesService;

  const jobSourceConfig: JobSourceConfig = {
    maxResultsPerSource: 2,
    sources: ['linkedin.com'],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobOffersService,
        {
          provide: JobOffersRepository,
          useValue: {
            findAll: vi.fn(),
            findById: vi.fn(),
            findPage: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            countBySource: vi.fn(),
          },
        },
        { provide: JOB_SOURCE_CONFIG, useValue: jobSourceConfig },
        {
          provide: CompaniesService,
          useValue: { findById: vi.fn(), exists: vi.fn() },
        },
      ],
    }).compile();

    service = module.get(JobOffersService);
    repository = module.get(JobOffersRepository);
    companiesService = module.get(CompaniesService);
  });

  describe('findAll (paginación por cursor)', () => {
    it('devuelve items y nextCursor cuando hay más páginas', async () => {
      const offers = [
        { id: 'o3', postedAt: new Date('2026-01-03') },
        { id: 'o2', postedAt: new Date('2026-01-02') },
        { id: 'o1', postedAt: new Date('2026-01-01') },
      ];
      vi.spyOn(repository, 'findPage').mockResolvedValue(offers as never);

      const result = await service.findAll(2);

      expect(repository.findPage).toHaveBeenCalledWith(3, null);
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeTruthy();
      expect(Buffer.from(result.nextCursor!, 'base64url').toString()).toContain(
        'o2',
      );
    });

    it('recorta a la página y no expone nextCursor al final', async () => {
      vi.spyOn(repository, 'findPage').mockResolvedValue([
        { id: 'o1', postedAt: new Date('2026-01-01') },
      ] as never);

      const result = await service.findAll(2);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('rechaza un cursor inválido con 400', async () => {
      await expect(service.findAll(2, 'not-a-cursor!')).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.findPage).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const dto = {
      companyId: 'company-1',
      title: 'Senior NestJS Dev',
      sourceUrl: 'https://linkedin.com/jobs/123',
      stack: ['NestJS'],
    };

    it('creates an offer from a real scraping source', async () => {
      vi.spyOn(companiesService, 'findById').mockResolvedValue({
        id: 'company-1',
      } as never);
      vi.spyOn(repository, 'countBySource').mockResolvedValue(0);
      const created = { id: 'offer-1', ...dto, source: 'linkedin.com' };
      vi.spyOn(repository, 'create').mockResolvedValue(created as never);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(repository.create).toHaveBeenCalledWith({
        ...dto,
        source: 'linkedin.com',
      });
    });

    it('marks offers from unknown sources as manual', async () => {
      vi.spyOn(companiesService, 'findById').mockResolvedValue({
        id: 'company-1',
      } as never);
      vi.spyOn(repository, 'create').mockImplementation((() => dto) as never);

      await service.create({ ...dto, sourceUrl: 'https://acme.com/careers/1' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'manual' }),
      );
    });

    it('throws ConflictException when source limit is reached', async () => {
      vi.spyOn(companiesService, 'findById').mockResolvedValue({
        id: 'company-1',
      } as never);
      vi.spyOn(repository, 'countBySource').mockResolvedValue(2);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the company does not exist', async () => {
      vi.spyOn(companiesService, 'findById').mockImplementation(async () => {
        throw new NotFoundException('not found');
      });

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an invalid source URL', async () => {
      vi.spyOn(companiesService, 'findById').mockResolvedValue({
        id: 'company-1',
      } as never);

      await expect(
        service.create({ ...dto, sourceUrl: 'not-a-url' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('throws JobOfferNotFoundException when the offer does not exist', async () => {
      vi.spyOn(repository, 'findById').mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(
        JobOfferNotFoundException,
      );
    });
  });

  describe('update', () => {
    it('throws JobOfferNotFoundException when the offer is missing', async () => {
      vi.spyOn(repository, 'update').mockResolvedValue(null);

      await expect(service.update('missing', { title: 'X' })).rejects.toThrow(
        JobOfferNotFoundException,
      );
    });

    it('validates the company before updating when companyId changes', async () => {
      vi.spyOn(companiesService, 'findById').mockImplementation(async () => {
        throw new NotFoundException('not found');
      });

      await expect(
        service.update('offer-1', { companyId: 'ghost' }),
      ).rejects.toThrow(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('throws JobOfferNotFoundException when the offer is missing', async () => {
      vi.spyOn(repository, 'delete').mockResolvedValue(false);

      await expect(service.delete('missing')).rejects.toThrow(
        JobOfferNotFoundException,
      );
    });
  });
});
