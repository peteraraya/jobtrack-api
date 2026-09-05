import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/utils/is-unique-violation.js';
import { isUuid } from '../../common/utils/is-uuid.js';
import { JobOfferNotFoundException } from '../job-offers/exceptions/job-offer-not-found.exception.js';
import { JobOffer } from '../job-offers/entities/job-offer.entity.js';
import { ApplicationsRepository } from './applications.repository.js';
import { Application } from './entities/application.entity.js';
import { ApplicationStatus } from './enums/application-status.enum.js';
import { DuplicateApplicationException } from './exceptions/duplicate-application.exception.js';
import { SlotsExhaustedException } from './exceptions/slots-exhausted.exception.js';

/**
 * Adaptador TypeORM de ApplicationsRepository.
 *
 * Reto transaccional: `createWithSlotDecrement` corre dentro de una
 * transacción — la postulación y el decremento de cupos se confirman juntos
 * (todo-o-nada) o no se confirman. El cupo se actualiza con una condición
 * atómica (`slots > 0`), así dos requests concurrentes no pueden pasarse.
 */
@Injectable()
export class TypeOrmApplicationsRepository extends ApplicationsRepository {
  constructor(
    @InjectRepository(Application)
    private readonly applicationRepository: Repository<Application>,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  override async findAll(): Promise<Application[]> {
    return this.applicationRepository.find({ order: { createdAt: 'DESC' } });
  }

  override async findById(id: string): Promise<Application | null> {
    if (!isUuid(id)) return null;
    return this.applicationRepository.findOneBy({ id });
  }

  override async create(data: {
    userId: string;
    jobOfferId: string;
  }): Promise<Application> {
    const application = this.applicationRepository.create(data);
    return this.applicationRepository.save(application);
  }

  override async existsByUserAndJobOffer(
    userId: string,
    jobOfferId: string,
  ): Promise<boolean> {
    return this.applicationRepository.existsBy({ userId, jobOfferId });
  }

  override async createWithSlotDecrement(
    data: { userId: string; jobOfferId: string },
    jobOfferId: string,
  ): Promise<Application> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        // Decremento atómico y condicional: solo descuenta si quedan cupos.
        // SELECT ... FOR UPDATE no es necesario: la fila queda bloqueada por
        // el propio UPDATE condicional.
        const result = await manager
          .createQueryBuilder()
          .update(JobOffer)
          .set({ slots: () => 'slots - 1' })
          .where('id = :id AND slots > 0', { id: jobOfferId })
          .execute();

        if ((result.affected ?? 0) === 0) {
          const offerExists = await manager.existsBy(JobOffer, {
            id: jobOfferId,
          });
          if (!offerExists) {
            throw new JobOfferNotFoundException(jobOfferId);
          }
          throw new SlotsExhaustedException(jobOfferId);
        }

        const application = manager.create(Application, {
          userId: data.userId,
          jobOfferId,
          status: ApplicationStatus.Applied,
        });
        return manager.save(application);
      });
    } catch (error) {
      // Red de seguridad para carreras: si dos aplicaciones del mismo usuario
      // llegan a la vez, la CHECK UNIQUE de la base dispara 409 (y no un 500).
      if (isUniqueViolation(error)) {
        throw new DuplicateApplicationException(data.userId, jobOfferId);
      }
      throw error;
    }
  }

  override async findAllWithJobOfferAndCompany(
    userId?: string,
  ): Promise<Application[]> {
    // Reto N+1: UNA query con joins. Sin este indicador, el getMany() traería
    // 1 + N queries (una por cada aplicación y su oferta/empresa). El filtro
    // por userId permite el scope de propiedad (owner ve solo lo suyo).
    return this.applicationRepository.find({
      where: userId ? { userId } : {},
      relations: { jobOffer: { company: true } },
      order: { createdAt: 'DESC' },
    });
  }

  override async updateStatus(
    id: string,
    status: ApplicationStatus,
  ): Promise<Application | null> {
    await this.applicationRepository.update({ id }, { status });
    return this.applicationRepository.findOneBy({ id });
  }
}
