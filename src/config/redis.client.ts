import type { RedisOptions } from '@nestjs/microservices';

/**
 * Módulo 9 — opciones de transporte Redis para @nestjs/microservices.
 *
 * La app expone un único puntero (REDIS_URL, el mismo que usan las colas
 * BullMQ) y este helper lo transforma en las opciones de host/port que el
 * cliente Reddis de microservicios espera. Convierte:
 *
 *   redis://usuario:clave@redis.example.com:6379/0
 *   → { host: 'redis.example.com', port: 6379, username: 'usuario', password: 'clave' }
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname || 'localhost',
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

export function redisMicroserviceOptions(
  redisUrl: string,
): RedisOptions['options'] {
  return parseRedisUrl(redisUrl);
}
