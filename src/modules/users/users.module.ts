import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity.js';
import { UsersRepository } from './users.repository.js';
import { TypeOrmUsersRepository } from './typeorm-users.repository.js';
import { UsersService } from './users.service.js';

/**
 * Módulo de usuarios. Expone UsersService para AuthModule (registro, login,
 * rotación de refresh y validación del token contra la DB).
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [
    UsersService,
    { provide: UsersRepository, useClass: TypeOrmUsersRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
