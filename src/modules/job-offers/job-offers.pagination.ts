import { BadRequestException } from '@nestjs/common';

/**
 * Paginación por cursor (keyset): el cursor opaco codifica (postedAt, id).
 * El cliente no necesita entender el formato — solo devuelve el `nextCursor`.
 */
export interface DateCursor {
  postedAt: Date;
  id: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(postedAt: Date, id: string): string {
  return Buffer.from(`${postedAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): DateCursor {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = raw.lastIndexOf('|');
    const id = raw.slice(separatorIndex + 1);
    const postedAt = new Date(raw.slice(0, separatorIndex));
    if (!id || Number.isNaN(postedAt.getTime())) {
      throw new Error('Invalid cursor payload');
    }
    return { postedAt, id };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
