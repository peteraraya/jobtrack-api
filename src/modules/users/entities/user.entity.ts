import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Application } from '../../applications/entities/application.entity.js';
import type { Notification } from '../../notifications/entities/notification.entity.js';
import type { Profile } from '../../profiles/entities/profile.entity.js';

@Entity('user')
export class User {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id: string;

  // Login por email: único a nivel de base de datos.
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  // Hash únicamente; nunca el password en claro (Module 4: bcrypt/argon2).
  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 10, default: 'user' })
  role: 'admin' | 'user';

  // Hash del refresh token actual (Módulo 4). Rotado en cada uso: el hash
  // cambia, el refresh anterior deja de ser válido aunque se intercepte.
  @Column({
    name: 'refresh_token_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  refreshTokenHash: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // Relaciones por nombre de entidad (evita ciclos ESM entre entidades).
  @OneToOne('profile', 'user')
  profile?: Profile;

  @OneToMany('application', 'user')
  applications?: Application[];

  @OneToMany('notification', 'user')
  notifications?: Notification[];

  constructor(data?: {
    email: string;
    passwordHash: string;
    role?: 'admin' | 'user';
  }) {
    if (data) {
      this.email = data.email;
      this.passwordHash = data.passwordHash;
      this.role = data.role ?? 'user';
    }
  }
}
