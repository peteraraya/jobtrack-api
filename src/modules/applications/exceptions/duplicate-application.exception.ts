import { ConflictException } from '@nestjs/common';

/**
 * RETO TIPO ENTREVISTA: un usuario no puede postular dos veces a la misma
 * oferta. Mapea a 409 Conflict con un mensaje claro y SIN filtrar detalles de
 * implementación (nombres de tablas, índices, repositorios, etc.).
 */
export class DuplicateApplicationException extends ConflictException {
  constructor(userId: string, jobOfferId: string) {
    super(`User "${userId}" already applied to job offer "${jobOfferId}"`);
    this.name = 'DuplicateApplicationException';
  }
}
