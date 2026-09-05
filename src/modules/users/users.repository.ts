import { User } from './entities/user.entity.js';

export type CreateUserData = {
  email: string;
  passwordHash: string;
  role?: 'admin' | 'user';
};

/**
 * Puerto de persistencia de usuarios. El email ÚNICO es una invariante que la
 * base garantiza (23505) — el adapter la traduce a 409 (conflicto de registro).
 */
export abstract class UsersRepository {
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findById(id: string): Promise<User | null>;
  abstract create(data: CreateUserData): Promise<User>;
  abstract setRefreshTokenHash(id: string, hash: string | null): Promise<void>;
}
