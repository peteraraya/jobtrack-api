import { z } from 'zod';

// Módulo 4: userId ya NO viaja en el body. El recurso se deduce del access
// token (ownership) — nunca se confía en IDs del cliente para autorizar.
export const CreateApplicationSchema = z
  .object({
    jobOfferId: z.string().uuid(),
  })
  .strict();

export class CreateApplicationDto {
  static schema = CreateApplicationSchema;

  jobOfferId: string;
}
