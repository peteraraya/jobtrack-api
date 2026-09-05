import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * DTO con esquema de validación propio (las clases creadas con `createZodDto`
 * o que exponen un `static schema`). Structural typing: el pipe no depende
 * de nestjs-zod; basta con que el DTO tenga `schema`.
 */
type ZodDtoConstructor = { schema?: ZodType };

/** Las claves desconocidas llegan con path vacío y `keys` (no tipado en v4). */
interface ZodIssueWithKeys {
  path: PropertyKey[];
  message: string;
  keys?: PropertyKey[];
}

/**
 * ValidationPipe basado en Zod (mantiene Zod como fuente única de verdad,
 * consistente con la validación de env vars del Módulo 0).
 *
 * Equivale a:
 * - whitelist + forbidNonWhitelisted: los esquemas usan `.strict()`, así que
 *   los campos desconocidos se RECHAZAN en lugar de descartarse.
 * - Mensajes de error consistentes: { statusCode, message, errors[] }.
 */
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
