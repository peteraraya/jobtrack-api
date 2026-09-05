import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import type { Application } from '../../applications/entities/application.entity.js';
import type { Company } from '../../companies/entities/company.entity.js';

// Índice compuesto (postedAt, id) para paginación por cursor con keyset.
@Entity('job_offer')
@Index(['postedAt', 'id'])
export class JobOffer {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  // Relaciones por nombre de entidad (evita ciclos ESM entre entidades).
  @ManyToOne('company', 'jobOffers', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'companyId' })
  company: Company;

  @Column({ type: 'uuid' })
  companyId: string;

  @OneToMany('application', 'jobOffer')
  applications?: Application[];

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  location: string;

  @Column({ type: 'simple-array', default: '' })
  stack: string[];

  // Una URL de origen no puede duplicarse: cada búsqueda se publica una vez.
  @Unique(['sourceUrl'])
  @Column({ type: 'varchar', length: 500 })
  sourceUrl: string;

  @Column({ type: 'varchar', length: 100 })
  source: string;

  // Cupos disponibles: decremento transaccional al postular.
  @Column({ type: 'int', default: 3 })
  slots: number;

  @CreateDateColumn({ type: 'timestamptz' })
  postedAt: Date;

  constructor(data?: {
    companyId: string;
    title: string;
    description?: string;
    location?: string;
    stack?: string[];
    sourceUrl: string;
    source: string;
    slots?: number;
  }) {
    if (data) {
      this.companyId = data.companyId;
      this.title = data.title;
      this.description = data.description ?? '';
      this.location = data.location ?? '';
      this.stack = data.stack ?? [];
      this.sourceUrl = data.sourceUrl;
      this.source = data.source;
      this.slots = data.slots ?? 3;
    }
  }
}
