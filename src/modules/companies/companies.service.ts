import { Injectable } from '@nestjs/common';
import { CompaniesRepository } from './companies.repository.js';
import { Company } from './entities/company.entity.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { CompanyNotFoundException } from './exceptions/company-not-found.exception.js';

@Injectable()
export class CompaniesService {
  constructor(private readonly companiesRepository: CompaniesRepository) {}

  async findAll(): Promise<Company[]> {
    return this.companiesRepository.findAll();
  }

  async findById(id: string): Promise<Company> {
    const company = await this.companiesRepository.findById(id);
    if (!company) {
      throw new CompanyNotFoundException(id);
    }
    return company;
  }

  async create(dto: CreateCompanyDto): Promise<Company> {
    return this.companiesRepository.create(dto);
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    const updated = await this.companiesRepository.update(id, dto);
    if (!updated) {
      throw new CompanyNotFoundException(id);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.companiesRepository.delete(id);
    if (!deleted) {
      throw new CompanyNotFoundException(id);
    }
  }

  /**
   * Módulo 7: la empresa fake de una fuente de scraping se crea la primera
   * vez que la fuente produce ofertas y se REUTILIZA en las siguientes
   * corridas (upsert). Nombre canónico: `Scraper: ${source}`.
   */
  async ensureBySource(source: string): Promise<Company> {
    const name = `Scraper: ${source}`;
    const existing = await this.companiesRepository.findByName(name);
    if (existing) return existing;
    return this.companiesRepository.create({ name });
  }
}
