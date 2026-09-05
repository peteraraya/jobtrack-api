import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { JobOffersService } from '../job-offers/job-offers.service.js';
import { ApplicationsService } from './applications.service.js';
import { ApplicationsRepository } from './applications.repository.js';
import { DuplicateApplicationException } from './exceptions/duplicate-application.exception.js';
import { ApplicationNotFoundException } from './exceptions/application-not-found.exception.js';
import { ApplicationStatus } from './enums/application-status.enum.js';
import type { AuthedUser } from '../auth/interfaces/authed-user.interface.js';

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let repository: ApplicationsRepository;
  let jobOffersService: JobOffersService;

  const jobOfferId = 'd1a4c2e5-eefe-4f0a-9d5f-9b8f8b6e4300';
  const ownerId = '3f7a5a59-cf45-4832-a5e5-b6e36319e4b0';
  const application = {
    id: 'application-1',
    userId: ownerId,
    jobOfferId,
    status: ApplicationStatus.Applied,
    createdAt: new Date(),
  };

  const owner: AuthedUser = {
    id: ownerId,
    email: 'ana@jobtrack.dev',
    role: 'user',
  };
  const intruder: AuthedUser = {
    id: '9d2e1a8b-0000-4000-8000-aaaaaaaaaaaa',
    email: 'bob@jobtrack.dev',
    role: 'user',
  };
  const admin: AuthedUser = {
    id: '1'.repeat(36),
    email: 'root@jobtrack.dev',
    role: 'admin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        {
          provide: ApplicationsRepository,
          useValue: {
            findAll: vi.fn(),
            findById: vi.fn(),
            create: vi.fn(),
            existsByUserAndJobOffer: vi.fn(),
            createWithSlotDecrement: vi.fn(),
            findAllWithJobOfferAndCompany: vi.fn(),
            updateStatus: vi.fn(),
          },
        },
        {
          provide: JobOffersService,
          useValue: { findById: vi.fn() },
        },
      ],
    }).compile();

    service = module.get(ApplicationsService);
    repository = module.get(ApplicationsRepository);
    jobOffersService = module.get(JobOffersService);
  });

  describe('apply(userId, dto)', () => {
    it('crea la aplicación con el userId del TOKEN (no del body)', async () => {
      vi.spyOn(jobOffersService, 'findById').mockResolvedValue({
        id: jobOfferId,
      } as never);
      vi.spyOn(repository, 'existsByUserAndJobOffer').mockResolvedValue(false);
      vi.spyOn(repository, 'createWithSlotDecrement').mockResolvedValue(
        application as never,
      );

      const result = await service.apply(owner.id, { jobOfferId });

      expect(result).toEqual(application);
      expect(repository.createWithSlotDecrement).toHaveBeenCalledWith(
        { userId: ownerId, jobOfferId },
        jobOfferId,
      );
    });

    it('lanza NotFoundException cuando la oferta no existe', async () => {
      vi.spyOn(jobOffersService, 'findById').mockImplementation(async () => {
        throw new NotFoundException('not found');
      });

      await expect(service.apply(owner.id, { jobOfferId })).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.createWithSlotDecrement).not.toHaveBeenCalled();
    });

    it('lanza DuplicateApplicationException si ya postuló', async () => {
      vi.spyOn(jobOffersService, 'findById').mockResolvedValue({
        id: jobOfferId,
      } as never);
      vi.spyOn(repository, 'existsByUserAndJobOffer').mockResolvedValue(true);

      await expect(service.apply(owner.id, { jobOfferId })).rejects.toThrow(
        DuplicateApplicationException,
      );
      expect(repository.createWithSlotDecrement).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus (reto ownership)', () => {
    it('el DUEÑO cambia su propio estado', async () => {
      vi.spyOn(repository, 'findById').mockResolvedValue(application as never);
      vi.spyOn(repository, 'updateStatus').mockResolvedValue({
        ...application,
        status: ApplicationStatus.Interview,
      } as never);

      const result = await service.updateStatus(
        application.id,
        owner,
        ApplicationStatus.Interview,
      );

      expect(result.status).toBe(ApplicationStatus.Interview);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        application.id,
        ApplicationStatus.Interview,
      );
    });

    it('UN INTRUSO no puede modificar la aplicación ajena aunque adivine el ID → 403', async () => {
      vi.spyOn(repository, 'findById').mockResolvedValue(application as never);

      await expect(
        service.updateStatus(
          application.id,
          intruder,
          ApplicationStatus.Rejected,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it('ADMIN puede modificar cualquier aplicación', async () => {
      vi.spyOn(repository, 'findById').mockResolvedValue(application as never);
      vi.spyOn(repository, 'updateStatus').mockResolvedValue({
        ...application,
        status: ApplicationStatus.Offer,
      } as never);

      const result = await service.updateStatus(
        application.id,
        admin,
        ApplicationStatus.Offer,
      );

      expect(result.status).toBe(ApplicationStatus.Offer);
    });

    it('404 si la aplicación no existe', async () => {
      vi.spyOn(repository, 'findById').mockResolvedValue(null);

      await expect(
        service.updateStatus(application.id, owner, ApplicationStatus.Offer),
      ).rejects.toThrow(ApplicationNotFoundException);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it('es idempotente: no re-escribe si el estado no cambia', async () => {
      vi.spyOn(repository, 'findById').mockResolvedValue(application as never);

      const result = await service.updateStatus(
        application.id,
        owner,
        ApplicationStatus.Applied,
      );

      expect(result).toEqual(application);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('findAllWithDetails / findAllByUserWithDetails (reto N+1)', () => {
    it('delega sin usuario (admin: todas) — una sola query con joins', async () => {
      vi.spyOn(repository, 'findAllWithJobOfferAndCompany').mockResolvedValue(
        [] as never,
      );

      await expect(service.findAllWithDetails()).resolves.toEqual([]);
      expect(repository.findAllWithJobOfferAndCompany).toHaveBeenCalledWith();
    });

    it('delega con el userId (owner) — scope de propiedad', async () => {
      vi.spyOn(repository, 'findAllWithJobOfferAndCompany').mockResolvedValue(
        [] as never,
      );

      await expect(service.findAllByUserWithDetails(ownerId)).resolves.toEqual(
        [],
      );
      expect(repository.findAllWithJobOfferAndCompany).toHaveBeenCalledWith(
        ownerId,
      );
    });
  });
});
