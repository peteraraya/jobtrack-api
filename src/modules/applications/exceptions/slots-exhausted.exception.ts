import { ConflictException } from '@nestjs/common';

/**
 * No quedan cupos disponibles en la oferta. Mapea a 409 Conflict y NO expone
 * internals de la base de datos (ni UPDATE, ni la columna `slots`).
 */
export class SlotsExhaustedException extends ConflictException {
  constructor(jobOfferId: string) {
    super(`Job offer "${jobOfferId}" has no available slots left`);
    this.name = 'SlotsExhaustedException';
  }
}
