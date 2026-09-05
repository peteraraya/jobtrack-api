import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import type { User } from '../../users/entities/user.entity.js';

@Entity('profile')
export class Profile {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  // 1:1 con usuario (join en el lado propietario: profile).
  @OneToOne('user', 'profile', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid', unique: true })
  userId: string;

  @Column({ type: 'simple-array', default: '' })
  stack: string[];

  @Column({ type: 'int', default: 0 })
  yearsOfExperience: number;

  // CV parseado (JSON arbitrario): se modela en Module 3, se usa en Module 5.
  @Column({ type: 'jsonb', nullable: true })
  cv: Record<string, unknown> | null;

  constructor(data?: {
    userId: string;
    stack?: string[];
    yearsOfExperience?: number;
    cv?: Record<string, unknown> | null;
  }) {
    if (data) {
      this.userId = data.userId;
      this.stack = data.stack ?? [];
      this.yearsOfExperience = data.yearsOfExperience ?? 0;
      this.cv = data.cv ?? null;
    }
  }
}
