import { describe, expect, it } from 'vitest';
import { parseRedisUrl, redisMicroserviceOptions } from './redis.client.js';

describe('parseRedisUrl', () => {
  it('convierte una URL simple en host y puerto por defecto', () => {
    expect(parseRedisUrl('redis://localhost')).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
    });
  });

  it('convierte host, puerto, usuario y clave', () => {
    expect(
      parseRedisUrl('redis://alice:s3cr3t@redis.example.com:6380/0'),
    ).toEqual({
      host: 'redis.example.com',
      port: 6380,
      username: 'alice',
      password: 's3cr3t',
    });
  });

  it('decodifica usuario/clave con caracteres escapados', () => {
    expect(parseRedisUrl('redis://a%20b:p%40ss@host/0')).toEqual({
      host: 'host',
      port: 6379,
      username: 'a b',
      password: 'p@ss',
    });
  });

  it('usa el puerto de la URL cuando está explícito', () => {
    expect(parseRedisUrl('redis://redis.example.com:6000').port).toBe(6000);
  });
});

describe('redisMicroserviceOptions', () => {
  it('devuelve las opciones de transporte compatibles con @nestjs/microservices', () => {
    const options = redisMicroserviceOptions('redis://user:pass@host:6379');
    expect(options).toEqual({
      host: 'host',
      port: 6379,
      username: 'user',
      password: 'pass',
    });
  });
});
