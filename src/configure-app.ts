import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { TrimPipe } from './common/pipes/trim.pipe.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';

/**
 * Configuración HTTP compartida entre runtime (main.ts) y e2e: los tests
 * ejercitan EXACTAMENTE la misma pipeline de pipes, filtros, helmet y CORS
 * que producción.
 */
export function configureApp(app: NestExpressApplication): void {
  // Módulo 10 — versionado semántico de la API desde ahora: todo contrato de
  // negocio vive bajo /v1 (envuelto, con headers de seguridad). La infra
  // (health) queda SIN prefijo: es un endpoint de orquestación, no de dominio.
  app.setGlobalPrefix('v1', { exclude: ['health'] });

  // Seguridad de headers (Módulo 4 + Módulo 10): además de los defaults de
  // helmet (X-Frame-Options, nosniff, CSP, oculta X-Powered-By) agregamos:
  // referrer-policy, cross-origin-resource-policy y origin-agent-cluster.
  app.use(
    helmet({
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      originAgentCluster: true,
    }),
  );

  // CORS explícito por whitelist de orígenes (nunca '*' en producción).
  const configService = app.get(ConfigService);
  const origins = String(configService.get('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : true });

  // Orden de pipes: trim (normalización) ANTES de validación.
  app.useGlobalPipes(new TrimPipe(), new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  // Body size limit explícito: evita payloads abusivos (DoS/ReDoS).
  app.useBodyParser('json', { limit: '1mb' });
}
