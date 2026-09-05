import { z } from 'zod';

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
