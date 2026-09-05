import { NotFoundException } from '@nestjs/common';

/**
 * Excepción de dominio: una oferta de trabajo no existe. Mapea a 404.
 */
export class JobOfferNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Job offer with id "${id}" not found`);
    this.name = 'JobOfferNotFoundException';
  }
}
