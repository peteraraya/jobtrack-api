import { z } from 'zod';

export const ListJobOffersQuerySchema = z
  .object({
    // z.coerce: los query params llegan como strings desde HTTP.
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().max(256).optional(),
  })
  .strict();

export class ListJobOffersQueryDto {
  static schema = ListJobOffersQuerySchema;

  limit: number;
  cursor?: string;
}
