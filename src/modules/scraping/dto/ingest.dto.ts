import { z } from 'zod';

export const IngestSchema = z
  .object({
    // Opcional: si llega, se procesa SOLO esa fuente; si no, todas las JOB_SOURCES.
    source: z.string().min(1).max(100).optional(),
    // `force` saltea la dedup por jobId (útil para demos/manual).
    force: z.boolean().optional(),
  })
  .strict();

export class IngestDto {
  static schema = IngestSchema;

  source?: string;
  force?: boolean;
}
