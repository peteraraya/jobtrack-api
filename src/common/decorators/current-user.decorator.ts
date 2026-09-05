import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthedUser } from '../../modules/auth/interfaces/authed-user.interface.js';

/**
 * Extrae el usuario autenticado (req.user) que deja JwtAuthGuard.
 * Uso: handler(@CurrentUser() user: AuthedUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthedUser => {
    return context.switchToHttp().getRequest().user as AuthedUser;
  },
);
