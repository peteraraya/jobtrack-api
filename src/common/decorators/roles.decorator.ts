import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export type AppRole = 'admin' | 'user';

/** Habilita RolesGuard: solo los roles listados pueden acceder al handler. */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
