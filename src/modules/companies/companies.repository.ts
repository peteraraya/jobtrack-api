import { Company } from './entities/company.entity.js';

export abstract class CompaniesRepository {
  abstract findAll(): Promise<Company[]>;
  abstract findById(id: string): Promise<Company | null>;
  abstract findByName(name: string): Promise<Company | null>;
  abstract create(data: {
    name: string;
    website?: string;
    location?: string;
  }): Promise<Company>;
  abstract update(
    id: string,
    data: { name?: string; website?: string; location?: string },
  ): Promise<Company | null>;
  abstract delete(id: string): Promise<boolean>;
}
