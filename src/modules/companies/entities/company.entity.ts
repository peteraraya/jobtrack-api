import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import type { JobOffer } from '../../job-offers/entities/job-offer.entity.js';

@Entity('company')
export class Company {
  // El default lo resuelve Postgres (gen_random_uuid), no generamos en memoria.
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  location: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // Las relaciones se declaran por nombre de entidad (registro global), no por
  // import: esto evita ciclos ESM con TDZ entre entidades.
  @OneToMany('job_offer', 'company')
  jobOffers?: JobOffer[];

  constructor(data?: {
    name: string;
    website?: string | null;
    location?: string | null;
  }) {
    if (data) {
      this.name = data.name;
      this.website = data.website ?? null;
      this.location = data.location ?? null;
    }
  }
}
