import { ConfigService } from '@nestjs/config';
import type { JobSourceConfig } from '../job-offers/job-source.config.js';
import { createJobSourceConfig } from '../job-offers/job-source.config.js';
import type { Env } from '../../config/configuration.js';

/**
 * Config resuelta del módulo de scraping. Se inyecta por token custom
 * (SCRAPE_RUNTIME_CONFIG): processors/scheduler/controller no conocen el
 * ConfigService — patrón puerto/adaptador del Módulo 1.
 */
export interface ScrapeRuntimeConfig {
  jobSource: JobSourceConfig;
  cronExpr: string;
  breakerThreshold: number;
  breakerCooldownMs: number;
  fetchTimeoutMs: number;
  jobAttempts: number;
  backoffMs: number;
}

export function createScrapeRuntimeConfig(
  configService: ConfigService<Env, true>,
): ScrapeRuntimeConfig {
  return {
    jobSource: createJobSourceConfig(configService),
    cronExpr: configService.get('SCRAPE_CRON_EXPR', { infer: true }),
    breakerThreshold: configService.get('SCRAPE_BREAKER_THRESHOLD', {
      infer: true,
    }),
    breakerCooldownMs: configService.get('SCRAPE_BREAKER_COOLDOWN_MS', {
      infer: true,
    }),
    fetchTimeoutMs: configService.get('SCRAPE_FETCH_TIMEOUT_MS', {
      infer: true,
    }),
    jobAttempts: configService.get('JOB_ATTEMPTS', { infer: true }),
    backoffMs: configService.get('JOB_BACKOFF_MS', { infer: true }),
  };
}
