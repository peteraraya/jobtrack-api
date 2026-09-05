import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUuid } from '../../common/utils/is-uuid.js';
import { CompaniesRepository } from './companies.repository.js';
import { Company } from './entities/company.entity.js';

/**
 * Adaptador TypeORM de CompaniesRepository. El service no cambió: el puerto
 * (DIP) queda igual, solo cambia la implementación por debajo.
 */
@Injectable()
export class TypeOrmCompaniesRepository extends CompaniesRepository {
  constructor(
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
  ) {
    super();
  }

  override async findAll(): Promise<Company[]> {
    return this.companyRepository.find({ order: { createdAt: 'DESC' } });
  }

  override async findById(id: string): Promise<Company | null> {
    if (!isUuid(id)) return null;
    return this.companyRepository.findOneBy({ id });
  }

  override async findByName(name: string): Promise<Company | null> {
    // Exacto y case-sensitive: las empresas scrapeadas se nombran de forma
    // canónica (p. ej. "Scraper: linkedin.com"), sin ambigüedad.
    return this.companyRepository.findOneBy({ name });
  }

  override async create(data: {
    name: string;
    website?: string;
    location?: string;
  }): Promise<Company> {
    const company = this.companyRepository.create({
      name: data.name,
      website: data.website ?? null,
      location: data.location ?? null,
    });
    return this.companyRepository.save(company);
  }

  override async update(
    id: string,
    data: { name?: string; website?: string; location?: string },
  ): Promise<Company | null> {
    const company = await this.findById(id);
    if (!company) return null;

    if (data.name !== undefined) company.name = data.name;
    if (data.website !== undefined) company.website = data.website ?? null;
    if (data.location !== undefined) company.location = data.location ?? null;
    return this.companyRepository.save(company);
  }

  override async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.companyRepository.delete(id);
    return (result.affected ?? 0) > 0;
  }
}
