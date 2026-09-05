import { z } from 'zod';

export const RefreshSchema = z
  .object({ refreshToken: z.string().min(1) })
  .strict();

export class RefreshDto {
  static schema = RefreshSchema;
  refreshToken: string;
}
