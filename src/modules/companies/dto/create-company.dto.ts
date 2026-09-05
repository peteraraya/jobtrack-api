import { z } from 'zod';

export const CreateCompanySchema = z
  .object({
    name: z.string().min(1).max(120),
    // ReDoS/DoS: límite explícito en campos de texto libre.
    website: z.string().url().max(255).optional(),
    location: z.string().max(120).optional(),
  })
  // Equivale a forbidNonWhitelisted: rechaza campos desconocidos.
  .strict();

export class CreateCompanyDto {
  static schema = CreateCompanySchema;

  name: string;
  website?: string;
  location?: string;
}
