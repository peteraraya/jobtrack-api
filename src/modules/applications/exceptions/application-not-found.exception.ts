import { NotFoundException } from '@nestjs/common';

export class ApplicationNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Application with id "${id}" not found`);
    this.name = 'ApplicationNotFoundException';
  }
}
