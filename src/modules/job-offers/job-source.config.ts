import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration.js';

/**
 * Token custom de inyección. El JobOffersService se acopla a esta "forma"
 * (interface), NO al ConfigService de Nest — patrón puerto/adaptador.
 * En entrevistas: "¿por qué custom token? Porque el service no conoce
 * la fuente de la configuración; un factory provider la resuelve en el módulo."
 */
export const JOB_SOURCE_CONFIG = 'JOB_SOURCE_CONFIG' as const;

export interface JobSourceConfig {
  /** Límite de ofertas permitidas por fuente de scraping. */
  maxResultsPerSource: number;
  /** Fuentes permitidas para scraping (hosts), ej. ['linkedin.com']. */
  sources: string[];
}

export function createJobSourceConfig(
  configService: ConfigService<Env, true>,
): JobSourceConfig {
  const raw = configService.get('JOB_SOURCES', { infer: true });
  const sources = raw
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter((source) => source.length > 0);

  return {
    maxResultsPerSource: configService.get('JOB_MAX_RESULTS_PER_SOURCE', {
      infer: true,
    }),
    sources,
  };
}
