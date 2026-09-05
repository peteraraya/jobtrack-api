import { UnauthorizedException } from '@nestjs/common';

/** Credenciales inválidas (email o password). 401. */
export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsException';
  }
}
