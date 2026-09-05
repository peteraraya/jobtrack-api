import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/utils/is-unique-violation.js';
import { User } from './entities/user.entity.js';
import { CreateUserData, UsersRepository } from './users.repository.js';

/**
 * Adaptador TypeORM del puerto UsersRepository. Mapea el 23505 (email único)
 * a 409 — red de seguridad para registros concurrentes con el mismo email.
 */
@Injectable()
export class TypeOrmUsersRepository extends UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super();
  }

  override async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
  }

  override async findById(id: string): Promise<User | null> {
    return this.userRepository.findOneBy({ id });
  }

  override async create(data: CreateUserData): Promise<User> {
    try {
      const user = this.userRepository.create(data);
      return await this.userRepository.save(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Email "${data.email}" is already registered`,
        );
      }
      throw error;
    }
  }

  override async setRefreshTokenHash(
    id: string,
    hash: string | null,
  ): Promise<void> {
    await this.userRepository.update({ id }, { refreshTokenHash: hash });
  }
}
