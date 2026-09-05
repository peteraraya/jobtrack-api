import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(10, 'JWT_SECRET must be at least 10 characters'),
  JWT_EXPIRATION: z.string().default('15m'),
  JWT_REFRESH_EXPIRATION: z.string().default('7d'),
  // Throttling global (todas las rutas).
  THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  // Throttling estricto para /auth/login y /auth/register (anti fuerza bruta).
  AUTH_THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(5),
  // Whitelist CORS separada por comas. Vacío = permisivo en desarrollo.
  CORS_ORIGINS: z.string().default(''),
  JOB_MAX_RESULTS_PER_SOURCE: z.coerce.number().default(10),
  JOB_SOURCES: z
    .string()
    .default('')
    .describe(
      'Comma-separated allowed scraping sources (e.g. linkedin.com,computrabajo.com)',
    ),
  // Módulo 7 — colas y scheduling.
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Expresión cron del scheduler de ingest (cada 6 horas por defecto).
  SCRAPE_CRON_EXPR: z.string().default('0 */6 * * *'),
  // Circuit breaker de las fuentes externas: cuántos fallos seguidos abren el
  // circuito y cuánto esperar antes de probar de nuevo (half-open).
  SCRAPE_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(3),
  SCRAPE_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(60000),
  // Retries con backoff exponencial de los jobs de la cola ingest.
  JOB_ATTEMPTS: z.coerce.number().int().positive().max(10).default(4),
  JOB_BACKOFF_MS: z.coerce.number().int().positive().default(2000),
  // Timeout por llamada a fuente externa (nunca esperar indefinido).
  SCRAPE_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type Env = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const message = Object.entries(errors)
      .map(([field, msgs]) => `  ${field}: ${msgs?.join(', ')}`)
      .join('\n');

    throw new Error(
      `Invalid environment variables:\n${message}\n\nCopy .env.example to .env and fill in the values.`,
    );
  }

  return result.data;
}
