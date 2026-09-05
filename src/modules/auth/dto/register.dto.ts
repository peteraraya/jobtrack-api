import { z } from 'zod';

export const RegisterSchema = z
  .object({
    email: z.string().email().max(255),
    // bcrypt trunca a 72 bytes: el límite evita surprises y DoS por costo.
    password: z.string().min(8).max(72),
  })
  .strict();

export class RegisterDto {
  static schema = RegisterSchema;
  email: string;
  password: string;
}
