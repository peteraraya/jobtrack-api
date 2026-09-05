# Módulo 0 — Fundamentos y setup del proyecto

> **Estado:** ✅ Completo · **Duración estimada:** 3–4 días
> **Rama de git:** `module-00-setup`

## Conceptos clave

- **Arquitectura de Nest:** decoradores, metadata reflection, cómo Nest arma el grafo de dependencias en el arranque.
- **CLI de Nest:** `nest new`, `nest g module/controller/service` y su convención de nombres.
- Estructura de carpetas **por feature**, no por capa técnica.
- Diferencia entre `main.ts` (bootstrap), `AppModule` (raíz del grafo de módulos) y módulos de feature.

## Lo que se implementó

### 1. Proyecto con TypeScript strict

`nest new jobtrack-api` con `strict: true` en `tsconfig.json`. Nest 12 trae Vitest y Oxlint por defecto (en vez de Jest y ESLint).

### 2. Lint + format + pre-commit

- **Oxlint** con reglas estrictas: `no-explicit-any: error`, `no-floating-promises: error`.
- **Prettier** con `singleQuote` y `trailingComma: all`.
- **Husky + lint-staged**: cada commit ejecuta lint y format solo sobre los archivos staged.

### 3. Config con validación Zod

`@nestjs/config` + Zod. La app **no levanta** si faltan variables críticas (`DATABASE_URL`, `JWT_SECRET`).

```ts
// src/config/configuration.ts
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
```

### 4. Health endpoint

Con `@nestjs/terminus`, valida que el proceso está vivo (sin DB todavía — eso llega en el Módulo 3).

```ts
// src/modules/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

@Controller()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
  ) {}

  @Get('health')
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
    ]);
  }
}
```

### 5. Bootstrap limpio

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import type { Env } from './config/configuration.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<Env, true>);
  const port = configService.get('PORT');
  const logger = new Logger('Bootstrap');

  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}
await bootstrap();
```

## Mejores prácticas aplicadas

- ✅ Sin `any` implícito ni explícito sin justificación.
- ✅ `.env.example` versionado, `.env` real en `.gitignore`.
- ✅ README inicial con instrucciones de setup.
- ✅ Health check básico disponible desde el primer commit.

## Verificación del entregable

```bash
npm run start:dev        # levanta el servidor
curl http://localhost:3000/health
# → {"status":"ok","info":{"memory_rss":{"status":"up"}},"error":{},"details":{"memory_rss":{"status":"up"}}}

npm run lint             # 0 warnings, 0 errors
npx prettier --check .   # todo formateado
```

## Siguiente módulo

[Módulo 1 — Módulos, controladores, providers e inyección de dependencias](/guide/module-01)
