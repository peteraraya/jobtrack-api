import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import type { JobOffer } from '../../job-offers/entities/job-offer.entity.js';
import type { User } from '../../users/entities/user.entity.js';
import { ApplicationStatus } from '../enums/application-status.enum.js';

// Invariante de negocio a nivel de base de datos:
// una persona no puede postular dos veces a la misma oferta.
@Entity('application')
@Unique(['userId', 'jobOfferId'])
@Index(['status'])
export class Application {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  // Relaciones por nombre de entidad (evita ciclos ESM entre entidades).
  @ManyToOne('user', 'applications', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne('job_offer', 'applications', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'jobOfferId' })
  jobOffer: JobOffer;

  @Column({ type: 'uuid' })
  jobOfferId: string;

  @Column({ type: 'varchar', length: 20, default: ApplicationStatus.Applied })
  status: ApplicationStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  constructor(data?: {
    userId: string;
    jobOfferId: string;
    status?: ApplicationStatus;
  }) {
    if (data) {
      this.userId = data.userId;
      this.jobOfferId = data.jobOfferId;
      this.status = data.status ?? ApplicationStatus.Applied;
    }
  }
}
