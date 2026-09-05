/**
 * Circuit breaker mínimo, sin dependencias externas.
 *
 * Tres estados:
 * - `closed`: normal. Cada fallo cuenta; al llegar a `threshold` pasa a open.
 * - `open`: NO se llama a la fuente (falla rápido con CircuitOpenError). Tras
 *   `cooldownMs` pasa a half-open (una sola request de sondeo).
 * - `half-open`: permite UNA request de prueba. Si tiene éxito → closed
 *   (reset de fallos). Si falla → open de nuevo (cooldown reiniciado).
 *
 * Está pensado para envolver SOLO la llamada externa (fetch del scraper), no
 * la lógica propia: protege al sistema de que una fuente caída lo tumbe.
 */
export class CircuitOpenError extends Error {
  constructor(source: string) {
    super(
      `Circuit is OPEN for source "${source}": failing fast, no external call`,
    );
    this.name = 'CircuitOpenError';
  }
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Fallos consecutivos que abren el circuito. */
  threshold: number;
  /** Tiempo en ms que el circuito queda abierto antes de sondear. */
  cooldownMs: number;
}

export class CircuitBreaker {
  private circuitState: CircuitState = 'closed';
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly source = 'default',
  ) {}

  get state(): CircuitState {
    return this.circuitState;
  }

  async call<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen) {
      // Cooldown cumplido → un sondeo half-open.
      if (Date.now() - (this.openedAt ?? 0) >= this.options.cooldownMs) {
        this.circuitState = 'half-open';
      } else {
        throw new CircuitOpenError(this.source);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private get isOpen(): boolean {
    return this.circuitState === 'open';
  }

  private onSuccess(): void {
    // En half-open, el sondeo exitoso CIERRA el circuito.
    this.circuitState = 'closed';
    this.failures = 0;
    this.openedAt = null;
  }

  private onFailure(): void {
    // Un fallo en half-open reabre con cooldown completo.
    if (
      this.circuitState === 'half-open' ||
      this.failures + 1 >= this.options.threshold
    ) {
      this.open();
      return;
    }
    this.failures += 1;
  }

  private open(): void {
    this.circuitState = 'open';
    this.failures = 0;
    this.openedAt = Date.now();
  }

  reset(): void {
    this.circuitState = 'closed';
    this.failures = 0;
    this.openedAt = null;
  }
}
