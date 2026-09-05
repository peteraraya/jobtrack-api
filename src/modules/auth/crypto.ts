import { createHash } from 'node:crypto';
import { compare, hash } from 'bcryptjs';

const PASSWORD_ROUNDS = 12;
const TOKEN_ROUNDS = 8;

// bcrypt solo usa los primeros 72 bytes de su entrada. Dos JWTs que difieren
// solo en jti/firma comparten header+payload (~los primeros bytes) y bcrypt
// los colisiona. Primero SHA-256 (32 bytes < 72) y sobre el digest → el hash
// cambia ante CUALQUIER cambio del token, por mínimo que sea.
function tokenDigest(refreshToken: string): string {
  return createHash('sha256').update(refreshToken, 'utf8').digest('hex');
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}

export function hashRefreshToken(refreshToken: string): Promise<string> {
  return hash(tokenDigest(refreshToken), TOKEN_ROUNDS);
}

export function verifyRefreshToken(
  refreshToken: string,
  hashToCompare: string,
) {
  return compare(tokenDigest(refreshToken), hashToCompare);
}

// Hash tonto cacheado: cuando el email no existe igual ejecutamos un verify
// bcrypt de costo similar para no dejar huella temporal (user enumeration).
let dummyHash: string | null = null;

export async function dummyPasswordVerify(): Promise<void> {
  dummyHash ??= await hash('timing-equalizer', PASSWORD_ROUNDS);
  await compare('timing-equalizer', dummyHash);
}
