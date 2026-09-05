import { describe, expect, it, vi, afterEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('comienza cerrado y deja pasar operaciones exitosas', async () => {
    const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 1000 });
    await expect(breaker.call(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.state).toBe('closed');
  });

  it('abre el circuito tras `threshold` fallos consecutivos', async () => {
    const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 1000 });

    const boom = () => Promise.reject(new Error('source down'));
    await expect(breaker.call(boom)).rejects.toThrow('source down');
    expect(breaker.state).toBe('closed'); // 1 fallo, aún cerrado

    await expect(breaker.call(boom)).rejects.toThrow('source down');
    expect(breaker.state).toBe('open'); // 2 fallos → open
  });

  it('mientras está OPEN falla rápido SIN llamar a la fuente (failing fast)', async () => {
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 5000 });
    await expect(
      breaker.call(() => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');

    const calls: string[] = [];
    await expect(
      breaker.call(() => {
        calls.push('called');
        return Promise.resolve('never');
      }),
    ).rejects.toThrow(CircuitOpenError);
    expect(calls).toHaveLength(0); // la operación NO se ejecutó
  });

  it('tras el cooldown pasa a half-open: un éxito CIERRA el circuito', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 1000 });

    await expect(
      breaker.call(() => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(breaker.state).toBe('open');

    vi.advanceTimersByTime(1000);
    await expect(breaker.call(async () => 'recuperado')).resolves.toBe(
      'recuperado',
    );
    expect(breaker.state).toBe('closed');
  });

  it('un fallo en half-open REABRE el circuito con cooldown completo', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 1000 });

    await expect(
      breaker.call(() => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');

    vi.advanceTimersByTime(1000); // → half-open (sondeo)
    await expect(
      breaker.call(() => Promise.reject(new Error('aun caido'))),
    ).rejects.toThrow('aun caido');
    expect(breaker.state).toBe('open');

    // Cooldown incompleto: sigue OPEN, sin ejecutar la operación.
    vi.advanceTimersByTime(500);
    await expect(breaker.call(async () => 'nunca')).rejects.toThrow(
      CircuitOpenError,
    );
  });
});
