import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/utils/is-unique-violation.js';
import { isUuid } from '../../common/utils/is-uuid.js';
import { JobOffer } from './entities/job-offer.entity.js';
import {
  CreateJobOfferData,
  DateCursor,
  JobOffersRepository,
  UpdateJobOfferData,
} from './job-offers.repository.js';

/**
 * Adaptador TypeORM de JobOffersRepository. La paginación es por keyset
 * ((postedAt, id) con el índice compuesto `(postedAt, id) DESC`): O(log n)
 * en la página siguiente, sin el drift de offset/limit.
 */
@Injectable()
export class TypeOrmJobOffersRepository extends JobOffersRepository {
  constructor(
    @InjectRepository(JobOffer)
    private readonly jobOfferRepository: Repository<JobOffer>,
  ) {
    super();
  }

  override async findAll(): Promise<JobOffer[]> {
    return this.jobOfferRepository.find({ order: { postedAt: 'DESC' } });
  }

  override async findById(id: string): Promise<JobOffer | null> {
    if (!isUuid(id)) return null;
    return this.jobOfferRepository.findOneBy({ id });
  }

  override async findPage(
    limit: number,
    after: DateCursor | null,
  ): Promise<JobOffer[]> {
    const query = this.jobOfferRepository
      .createQueryBuilder('offer')
      .orderBy('offer.postedAt', 'DESC')
      .addOrderBy('offer.id', 'DESC')
      .limit(limit);

    if (after !== null) {
      query.andWhere('(offer.postedAt, offer.id) < (:postedAt, :id)', {
        postedAt: after.postedAt,
        id: after.id,
      });
    }

    return query.getMany();
  }

  override async create(data: CreateJobOfferData): Promise<JobOffer> {
    const offer = this.jobOfferRepository.create({
      companyId: data.companyId,
      title: data.title,
      description: data.description ?? '',
      location: data.location ?? '',
      stack: data.stack ?? [],
      sourceUrl: data.sourceUrl,
      source: data.source,
    });
    try {
      return await this.jobOfferRepository.save(offer);
    } catch (error) {
      // Una fuente no puede publicar dos veces la misma URL: 409 y no un 500.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Job offer with sourceUrl "${data.sourceUrl}" already exists`,
        );
      }
      throw error;
    }
  }

  override async existsBySourceUrl(sourceUrl: string): Promise<boolean> {
    return this.jobOfferRepository.existsBy({ sourceUrl });
  }

  override async upsertFromSource(data: CreateJobOfferData): Promise<{
    offer: JobOffer;
    created: boolean;
  }> {
    const exists = await this.existsBySourceUrl(data.sourceUrl);

    // ON CONFLICT (sourceUrl) DO UPDATE: reintentar un job de scraping nunca
    // duplica — actualiza en su lugar (idempotencia real por constraint).
    await this.jobOfferRepository
      .createQueryBuilder()
      .insert()
      .into(JobOffer)
      .values({
        companyId: data.companyId,
        title: data.title,
        description: data.description ?? '',
        location: data.location ?? '',
        stack: data.stack ?? [],
        sourceUrl: data.sourceUrl,
        source: data.source,
      })
      .orUpdate(
        ['title', 'description', 'location', 'stack', 'source'],
        ['sourceUrl'],
      )
      .execute();

    const offer = await this.jobOfferRepository.findOneByOrFail({
      sourceUrl: data.sourceUrl,
    });
    return { offer, created: !exists };
  }

  override async update(
    id: string,
    data: UpdateJobOfferData,
  ): Promise<JobOffer | null> {
    const offer = await this.findById(id);
    if (!offer) return null;

    if (data.companyId !== undefined) offer.companyId = data.companyId;
    if (data.title !== undefined) offer.title = data.title;
    if (data.description !== undefined) offer.description = data.description;
    if (data.location !== undefined) offer.location = data.location;
    if (data.stack !== undefined) offer.stack = data.stack;
    if (data.sourceUrl !== undefined) offer.sourceUrl = data.sourceUrl;
    return this.jobOfferRepository.save(offer);
  }

  override async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.jobOfferRepository.delete(id);
    return (result.affected ?? 0) > 0;
  }

  override async countBySource(source: string): Promise<number> {
    return this.jobOfferRepository.countBy({ source });
  }
}
