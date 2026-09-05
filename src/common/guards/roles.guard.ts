import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY, type AppRole } from '../decorators/roles.decorator.js';

/**
 * Guard de AUTORIZACIÓN (¿qué podés hacer?): RBAC por rol.
 *
 * Se evalúa DESPUÉS de JwtAuthGuard, así que req.user ya existe. Sin metadata
 * @Roles(...) el handler es accesible para cualquier usuario autenticado.
 * Contrasta con el reto de ownership (ABAC): el rol no alcanza para
 * "¿podés modificar ESTA application?" — ahí se precisa el recurso real.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Insufficient permissions: required role "${requiredRoles.join('/')}"`,
      );
    }
    return true;
  }
}
