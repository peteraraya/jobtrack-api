import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { User } from '../../users/entities/user.entity.js';

@Entity('notification')
@Index(['userId'])
export class Notification {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  @ManyToOne('user', 'notifications', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 30 })
  type: 'new_offer' | 'status_changed';

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  constructor(data?: {
    userId: string;
    type: 'new_offer' | 'status_changed';
    payload?: Record<string, unknown> | null;
    readAt?: Date | null;
  }) {
    if (data) {
      this.userId = data.userId;
      this.type = data.type;
      this.payload = data.payload ?? null;
      this.readAt = data.readAt ?? null;
    }
  }
}
