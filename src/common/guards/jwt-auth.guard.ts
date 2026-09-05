import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * Guard de AUTENTICACIÓN (¿quién sos?). Usa la estrategia passport 'jwt'.
 *
 * Registrado como APP_GUARD global: TODA ruta exige token salvo las marcadas
 * @Public(). La autorización (¿qué podés hacer?) queda en RolesGuard — se
 * mantienen separadas a propósito.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
