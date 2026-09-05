import { Injectable } from '@nestjs/common';
import { User } from './entities/user.entity.js';
import { CreateUserData, UsersRepository } from './users.repository.js';

/**
 * Servicio de usuarios: solo operaciones sobre el recurso. NO maneja
 * contraseñas en claro ni emite tokens — esa responsabilidad es de AuthService.
 */
@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findById(id);
  }

  create(data: CreateUserData): Promise<User> {
    return this.usersRepository.create(data);
  }

  setRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    return this.usersRepository.setRefreshTokenHash(id, hash);
  }
}
