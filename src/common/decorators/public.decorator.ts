import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca un handler como público: salta JwtAuthGuard (pero no ThrottlerGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
