import { z } from 'zod';

export const UpdateCompanySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    website: z.string().url().max(255).optional(),
    location: z.string().max(120).optional(),
  })
  .strict();

export class UpdateCompanyDto {
  static schema = UpdateCompanySchema;

  name?: string;
  website?: string;
  location?: string;
}
