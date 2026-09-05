import { Application } from './entities/application.entity.js';
import { ApplicationStatus } from './enums/application-status.enum.js';

/**
 * Puerto de persistencia de aplicaciones. La unicidad
 * (mismo userId + jobOfferId) es una invariante de NEGOCIO: el repository
 * la expone como consulta, el service decide qué hacer con ella.
 */
export abstract class ApplicationsRepository {
  abstract findAll(): Promise<Application[]>;
  abstract findById(id: string): Promise<Application | null>;
  abstract create(data: {
    userId: string;
    jobOfferId: string;
  }): Promise<Application>;
  abstract existsByUserAndJobOffer(
    userId: string,
    jobOfferId: string,
  ): Promise<boolean>;
  /**
   * Operación transaccional: crea la postulación y decrementa los cupos de la
   * oferta en el MISMO commit (todo-o-nada).
   */
  abstract createWithSlotDecrement(
    data: { userId: string; jobOfferId: string },
    jobOfferId: string,
  ): Promise<Application>;
  /**
   * Se usa en el Reto N+1: una sola query con joins, sin loops.
   * Con `userId` filtra las postulaciones del usuario (propietario);
   * sin él devuelve todas (admin).
   */
  abstract findAllWithJobOfferAndCompany(
    userId?: string,
  ): Promise<Application[]>;
  /** Actualiza el estado y devuelve la entidad nueva (null si no existe). */
  abstract updateStatus(
    id: string,
    status: ApplicationStatus,
  ): Promise<Application | null>;
}
