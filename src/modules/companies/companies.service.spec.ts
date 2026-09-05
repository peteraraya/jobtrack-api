import { Test, TestingModule } from '@nestjs/testing';
import { CompaniesService } from './companies.service.js';
import { CompaniesRepository } from './companies.repository.js';
import { CompanyNotFoundException } from './exceptions/company-not-found.exception.js';

describe('CompaniesService', () => {
  let service: CompaniesService;
  let repository: CompaniesRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        {
          provide: CompaniesRepository,
          useValue: {
            findAll: vi.fn(),
            findById: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(CompaniesService);
    repository = module.get(CompaniesRepository);
  });

  describe('findAll', () => {
    it('delegates to the repository', async () => {
      const companies = [{ id: 'c1', name: 'Acme' }];
      vi.spyOn(repository, 'findAll').mockResolvedValue(companies as never);

      await expect(service.findAll()).resolves.toEqual(companies);
      expect(repository.findAll).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns a company when it exists', async () => {
      const company = { id: 'c1', name: 'Acme' };
      vi.spyOn(repository, 'findById').mockResolvedValue(company as never);

      const result = await service.findById('c1');

      expect(result).toEqual(company);
      expect(repository.findById).toHaveBeenCalledWith('c1');
    });

    it('throws CompanyNotFoundException when it does not exist', async () => {
      vi.spyOn(repository, 'findById').mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(
        CompanyNotFoundException,
      );
    });
  });

  describe('create', () => {
    it('delegates creation to the repository', async () => {
      const dto = { name: 'Acme', website: 'https://acme.com' };
      const created = { id: 'c1', ...dto, createdAt: new Date() };
      vi.spyOn(repository, 'create').mockResolvedValue(created as never);

      const result = await service.create(dto);

      expect(result).toBe(created);
      expect(repository.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('throws CompanyNotFoundException when company is missing', async () => {
      vi.spyOn(repository, 'update').mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        CompanyNotFoundException,
      );
    });

    it('returns the updated company when found', async () => {
      const updated = { id: 'c1', name: 'Acme 2' };
      vi.spyOn(repository, 'update').mockResolvedValue(updated as never);

      await expect(service.update('c1', { name: 'Acme 2' })).resolves.toEqual(
        updated,
      );
    });
  });

  describe('delete', () => {
    it('throws CompanyNotFoundException when company is missing', async () => {
      vi.spyOn(repository, 'delete').mockResolvedValue(false);

      await expect(service.delete('missing')).rejects.toThrow(
        CompanyNotFoundException,
      );
    });

    it('returns void when the company was deleted', async () => {
      vi.spyOn(repository, 'delete').mockResolvedValue(true);

      await expect(service.delete('c1')).resolves.toBeUndefined();
    });
  });
});
