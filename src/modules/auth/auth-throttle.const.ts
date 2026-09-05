/**
 * Límites del rate limit estricto de /auth/login y /auth/register.
 * Se leen a TIEMPO DE IMPORTACION desde el env (dotenv se carga antes que los
 * módulos: ver main.ts y el setup de vitest). Caen a 5 peticiones/min por
 * defecto — contra fuerza bruta de credenciales.
 */
export const AUTH_THROTTLE_LIMIT = Number(process.env.AUTH_THROTTLE_LIMIT ?? 5);
export const AUTH_THROTTLE_TTL = Number(
  process.env.AUTH_THROTTLE_TTL ?? 60_000,
);
