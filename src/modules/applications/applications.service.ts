import { ForbiddenException, Injectable } from '@nestjs/common';
import { JobOffersService } from '../job-offers/job-offers.service.js';
import { ApplicationsRepository } from './applications.repository.js';
import { CreateApplicationDto } from './dto/create-application.dto.js';
import { Application } from './entities/application.entity.js';
import { ApplicationStatus } from './enums/application-status.enum.js';
import { ApplicationNotFoundException } from './exceptions/application-not-found.exception.js';
import { DuplicateApplicationException } from './exceptions/duplicate-application.exception.js';
import type { AuthedUser } from '../auth/interfaces/authed-user.interface.js';

@Injectable()
export class ApplicationsService {
  constructor(
    // Puerto desacoplado del ORM (DIP).
    private readonly applicationsRepository: ApplicationsRepository,
    // Reutiliza JobOffersService del módulo job-offers vía imports/exports.
    private readonly jobOffersService: JobOffersService,
  ) {}

  /** Admin: todas las postulaciones. */
  async findAllWithDetails(): Promise<Application[]> {
    return this.applicationsRepository.findAllWithJobOfferAndCompany();
  }

  /** Usuario común: solo sus postulaciones (scope de propiedad). */
  async findAllByUserWithDetails(userId: string): Promise<Application[]> {
    return this.applicationsRepository.findAllWithJobOfferAndCompany(userId);
  }

  /**
   * Módulo 4: el userId nunca viene del body — sale del access token.
   * La oferta se valida (404 si no existe) y el par usuario+oferta se
   * decrementa/crea en UNA transacción (Módulo 3).
   */
  async apply(userId: string, dto: CreateApplicationDto): Promise<Application> {
    await this.jobOffersService.findById(dto.jobOfferId);

    if (
      await this.applicationsRepository.existsByUserAndJobOffer(
        userId,
        dto.jobOfferId,
      )
    ) {
      throw new DuplicateApplicationException(userId, dto.jobOfferId);
    }

    return this.applicationsRepository.createWithSlotDecrement(
      { userId, jobOfferId: dto.jobOfferId },
      dto.jobOfferId,
    );
  }

  /**
   * Reto ownership: solo el DUEÑO o un admin puede cambiar el estado. El rol
   * solo no alcanza (un `user` no es dueño de una application ajena aunque
   * le pegue el ID) — se verifica contra el recurso real (ABAC).
   */
  async updateStatus(
    id: string,
    requester: AuthedUser,
    status: ApplicationStatus,
  ): Promise<Application> {
    const application = await this.applicationsRepository.findById(id);
    if (!application) {
      throw new ApplicationNotFoundException(id);
    }

    const isOwner = application.userId === requester.id;
    const isAdmin = requester.role === 'admin';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'You can only update status of your own applications',
      );
    }

    if (application.status === status) return application;

    const updated = await this.applicationsRepository.updateStatus(id, status);
    if (!updated) {
      throw new ApplicationNotFoundException(id);
    }
    return updated;
  }
}
