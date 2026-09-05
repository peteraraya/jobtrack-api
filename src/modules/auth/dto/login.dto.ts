import { z } from 'zod';

export const LoginSchema = z
  .object({
    email: z.string().email().max(255),
    password: z.string().min(1).max(72),
  })
  .strict();

export class LoginDto {
  static schema = LoginSchema;
  email: string;
  password: string;
}
