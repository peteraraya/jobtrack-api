import { z } from 'zod';

export const UpdateJobOfferSchema = z
  .object({
    companyId: z.string().uuid().optional(),
    title: z.string().min(3).max(120).optional(),
    description: z.string().max(5000).optional(),
    location: z.string().max(200).optional(),
    stack: z.array(z.string().min(1).max(30)).max(20).optional(),
    sourceUrl: z.string().url().max(500).optional(),
  })
  .strict();

export class UpdateJobOfferDto {
  static schema = UpdateJobOfferSchema;

  companyId?: string;
  title?: string;
  description?: string;
  location?: string;
  stack?: string[];
  sourceUrl?: string;
}
