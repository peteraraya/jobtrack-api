import { UnauthorizedException } from '@nestjs/common';

/**
 * Refresh token inválido, expirado o REUTILIZADO. 401.
 * La reutilización se detecta porque el hash en DB ya fue rotado en el uso
 * anterior y no vuelve a coincidir.
 */
export class InvalidRefreshTokenException extends UnauthorizedException {
  constructor() {
    super('Invalid refresh token');
    this.name = 'InvalidRefreshTokenException';
  }
}
