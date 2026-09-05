import { Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';

/**
 * PIPE CUSTOM. Normaliza strings del body quitando espacios extra ANTES de la
 * validación. Demuestra el orden de ejecución de los pipes: este se registra
 * antes del ZodValidationPipe, por eso los esquemas pueden asumir input limpio.
 */
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
