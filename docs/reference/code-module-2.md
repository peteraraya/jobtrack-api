# Código fuente — Módulo 2

Código real del proyecto al cierre del Módulo 2: la pipeline de validación y errores de la API.

## `src/common/pipes/zod-validation.pipe.ts`

`ValidationPipe` basado en Zod. Valida solo parámetros cuyo metatype exponga `static schema`; el resto pasa intacto. Devuelve el dato **parsed** por Zod (no el raw).

```ts
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Las claves desconocidas llegan con path vacío y `keys` (no tipado en v4). */
interface ZodIssueWithKeys {
  path: PropertyKey[];
  message: string;
  keys?: PropertyKey[];
}

type ZodDtoConstructor = { schema?: ZodType };

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  private readonly logger = new Logger(ZodValidationPipe.name);

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const metatype = metadata.metatype as ZodDtoConstructor | undefined;
    const schema = metatype?.schema;

    if (!schema) return value;

    const result = schema.safeParse(value);

    if (!result.success) {
      const issues = result.error.issues as ZodIssueWithKeys[];
      const errors = issues.map((issue) => ({
        field:
          issue.path.length > 0
            ? issue.path.join('.')
            : (issue.keys?.join(',') ?? ''),
        message: issue.message,
      }));

      this.logger.debug(
        `Validation failed for ${metadata.type}: ${JSON.stringify(errors)}`,
      );

      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        errors,
      });
    }

    return result.data;
  }
}
```

## `src/common/pipes/trim.pipe.ts`

Pipe custom de normalización. Se registra ANTES del de validación, así que los esquemas asumen input limpio (trims también dentro de arrays y objetos anidados).

```ts
import { Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';

@Injectable()
export class TrimPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') return value;
    return deepTrim(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepTrim(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(deepTrim);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepTrim(item)]),
    );
  }
  return value;
}
```

## `src/common/filters/all-exceptions.filter.ts`

`@Catch()` sin argumentos captura absolutamente todo. Logea el detalle interno (stack) y expone al cliente una respuesta mínima y segura — nunca stack traces en producción.

```ts
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  status: number;
  message: string;
  errors?: unknown[];
}

/** Errores HTTP "de facto" sin ser HttpException (p. ej. 413 del body-parser). */
interface HttpLikeError {
  status?: number;
  statusCode?: number;
  message?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body =
      exception instanceof HttpException
        ? this.toHttpBody(exception)
        : (this.toHttpLikeBody(exception) ?? this.toUnknownBody(exception));

    if (exception instanceof HttpException) {
      this.logger.warn(`${request.method} ${request.url} -> ${body.status}`);
    } else {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.status).json({
      statusCode: body.status,
      message: body.message,
      ...(body.errors === undefined ? {} : { errors: body.errors }),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private toHttpBody(exception: HttpException): ErrorBody {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return { status, message: response };
    }

    if (response && typeof response === 'object') {
      const { message, errors } = response as {
        message?: string | string[];
        errors?: unknown[];
      };

      const finalMessage =
        typeof message === 'string'
          ? message
          : Array.isArray(message)
            ? message.join(', ')
            : exception.message;

      return {
        status,
        message: finalMessage,
        ...(errors === undefined ? {} : { errors }),
      };
    }

    return { status, message: exception.message };
  }

  private toHttpLikeBody(exception: unknown): ErrorBody | null {
    if (!(exception instanceof Error) && typeof exception !== 'object') {
      return null;
    }

    const { status, statusCode, message } = exception as HttpLikeError;
    const numericStatus =
      typeof statusCode === 'number'
        ? statusCode
        : typeof status === 'number'
          ? status
          : null;

    if (numericStatus === null || numericStatus < 400 || numericStatus > 599) {
      return null;
    }

    return {
      status: numericStatus,
      message:
        process.env.NODE_ENV === 'production'
          ? 'Request error'
          : (message ?? 'Request error'),
    };
  }

  private toUnknownBody(exception: unknown): ErrorBody {
    const details =
      exception instanceof Error ? exception.message : 'Unknown error';

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : details,
    };
  }
}
```

## `src/configure-app.ts`

Pipeline compartida entre runtime y e2e. Punto de entrevista: en un test que usa `createNestApplication()` los pipes/filtros globales **no** se aplican solos — hay que invocar `configureApp`.

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { TrimPipe } from './common/pipes/trim.pipe.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';

export function configureApp(app: NestExpressApplication): void {
  // Orden de pipes: trim (normalización) ANTES de validación.
  app.useGlobalPipes(new TrimPipe(), new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  // Body size limit explícito: evita payloads abusivos (DoS/ReDoS).
  app.useBodyParser('json', { limit: '1mb' });
}
```

## `src/modules/applications/` — reto `DuplicateApplicationException`

```ts
// applications/exceptions/duplicate-application.exception.ts
import { ConflictException } from '@nestjs/common';

export class DuplicateApplicationException extends ConflictException {
  constructor(userId: string, jobOfferId: string) {
    super(`User "${userId}" already applied to job offer "${jobOfferId}"`);
    this.name = 'DuplicateApplicationException';
  }
}
```

```ts
// applications/applications.service.ts
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly applicationsRepository: ApplicationsRepository,
    private readonly jobOffersService: JobOffersService,
  ) {}

  findAll(): Application[] {
    return this.applicationsRepository.findAll();
  }

  apply(dto: CreateApplicationDto): Application {
    this.jobOffersService.findById(dto.jobOfferId);
    if (
      this.applicationsRepository.existsByUserAndJobOffer(
        dto.userId,
        dto.jobOfferId,
      )
    ) {
      throw new DuplicateApplicationException(dto.userId, dto.jobOfferId);
    }
    return this.applicationsRepository.create(dto);
  }
}
```

## `src/modules/applications/applications.module.ts`

```ts
@Module({
  imports: [JobOffersModule], // JobOffersModule EXPORTA JobOffersService
  controllers: [ApplicationsController],
  providers: [
    ApplicationsService,
    {
      provide: ApplicationsRepository,
      useClass: InMemoryApplicationsRepository,
    },
  ],
})
export class ApplicationsModule {}
```

## DTO con Zod (ejemplo `job-offers`)

Todos los DTOs de `companies`, `job-offers` y `applications` siguen el patrón clase + `static schema` con `.strict()`:

```ts
export const CreateJobOfferSchema = z
  .object({
    companyId: z.string().uuid(),
    title: z.string().min(3).max(120),
    description: z.string().max(5000).optional(),
    location: z.string().max(200).optional(),
    stack: z.array(z.string().min(1).max(30)).max(20).optional(),
    sourceUrl: z.string().url().max(500),
  })
  .strict();

export class CreateJobOfferDto {
  static schema = CreateJobOfferSchema;
  companyId: string;
  title: string;
  description?: string;
  location?: string;
  stack?: string[];
  sourceUrl: string;
}
```

## Tests

- `src/modules/companies/companies.service.spec.ts` (6) — ahora valida `CompanyNotFoundException`.
- `src/modules/job-offers/job-offers.service.spec.ts` (9) — valida `JobOfferNotFoundException` y `BadRequestException`/`ConflictException`.
- `src/modules/applications/applications.service.spec.ts` (4) — caso feliz, oferta inexistente (404), duplicado (409).
- `test/app.e2e-spec.ts` (8) — `/health`, `forbidNonWhitelisted` (400), trim de input, body incompleto (400), 404 estructurado, 409 por duplicado y 413 por body > 1MB.

Total: **19 unit + 8 e2e**. 🎯
