import { NotFoundException } from '@nestjs/common';

/**
 * Excepción de dominio. Hereda de HttpException (404) pero tiene un nombre
 * semántico: el cliente la percibe como un 404 estándar, el código sabe qué
 * recurso específico faltó sin filtrar detalles de implementación.
 */
export class CompanyNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Company with id "${id}" not found`);
    this.name = 'CompanyNotFoundException';
  }
}
