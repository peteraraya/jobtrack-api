import { JobOffer } from './entities/job-offer.entity.js';

export interface CreateJobOfferData {
  companyId: string;
  title: string;
  description?: string;
  location?: string;
  stack?: string[];
  sourceUrl: string;
  source: string;
}

export interface UpdateJobOfferData {
  companyId?: string;
  title?: string;
  description?: string;
  location?: string;
  stack?: string[];
  sourceUrl?: string;
}

/** Cursor para paginación por keyset: (postedAt, id). */
export interface DateCursor {
  postedAt: Date;
  id: string;
}

export abstract class JobOffersRepository {
  abstract findAll(): Promise<JobOffer[]>;
  abstract findById(id: string): Promise<JobOffer | null>;
  /**
   * Página de ofertas ordenadas por (postedAt DESC, id DESC). Devuelve
   * limit+1 elementos: el extra permite al service saber si hay más páginas.
   */
  abstract findPage(
    limit: number,
    after: DateCursor | null,
  ): Promise<JobOffer[]>;
  abstract create(data: CreateJobOfferData): Promise<JobOffer>;
  /**
   * Upsert idempotente del scraping (Módulo 7): inserta o actualiza por
   * `sourceUrl` usando ON CONFLICT (la URL es la idempotency key natural).
   * Devuelve la oferta resultante; `created` distingue inserción de update.
   */
  abstract upsertFromSource(
    data: CreateJobOfferData,
  ): Promise<{ offer: JobOffer; created: boolean }>;
  abstract existsBySourceUrl(sourceUrl: string): Promise<boolean>;
  abstract update(
    id: string,
    data: UpdateJobOfferData,
  ): Promise<JobOffer | null>;
  abstract delete(id: string): Promise<boolean>;
  abstract countBySource(source: string): Promise<number>;
}
