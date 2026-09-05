import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/configuration.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  dummyPasswordVerify,
  hashPassword,
  hashRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from './crypto.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import type { AuthedUser } from './interfaces/authed-user.interface.js';
import type { JwtPayload } from './interfaces/jwt-payload.interface.js';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception.js';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception.js';

/** Respuesta de formulario de session: tokens + datos públicos del user. */
export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthedUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  toPublicUser(user: User): AuthedUser {
    return { id: user.id, email: user.email, role: user.role };
  }

  private async issueTokens(
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // jti único por firma: dos tokens del mismo segundo NO pueden ser
    // idénticos (si fueran iguales, la rotación no detectaría la reutilización).
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: randomUUID(),
    };

    // Access: vida corta, firma por defecto del módulo (JWT_EXPIRATION).
    const accessToken = await this.jwtService.signAsync(payload);

    // Refresh: vida larga, rotado en cada uso. Se guarda HASHED en DB.
    const refreshToken = await this.jwtService.signAsync(payload, {
      expiresIn: this.configService.getOrThrow('JWT_REFRESH_EXPIRATION'),
    });

    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    if (await this.usersService.findByEmail(dto.email)) {
      throw new ConflictException(`Email "${dto.email}" is already registered`);
    }

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash: await hashPassword(dto.password),
      role: 'user', // Solo se crean usuarios comunes; admin se promueve (seed).
    });

    const tokens = await this.issueTokens(user);
    await this.usersService.setRefreshTokenHash(
      user.id,
      await hashRefreshToken(tokens.refreshToken),
    );

    return { ...tokens, user: this.toPublicUser(user) };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);

    // Si no existe el usuario, igual corre un verify bcrypt de costo similar
    // (huella temporal idéntica → no se filtra qué emails están registrados).
    const passwordMatches = user
      ? await verifyPassword(dto.password, user.passwordHash)
      : await dummyPasswordVerify().then(() => false);

    if (!user || !passwordMatches) {
      throw new InvalidCredentialsException();
    }

    const tokens = await this.issueTokens(user);
    await this.usersService.setRefreshTokenHash(
      user.id,
      await hashRefreshToken(tokens.refreshToken),
    );

    return { ...tokens, user: this.toPublicUser(user) };
  }

  /**
   * Refresh token rotation: cada uso emite un par NUEVO y reemplaza el hash
   * guardado. Si alguien reutiliza un refresh ya rotado (o robado), el hash
   * almacenado ya no coincide → 401.
   */
  async refresh(dto: RefreshDto): Promise<AuthResult> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(dto.refreshToken);
    } catch {
      throw new InvalidRefreshTokenException();
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user?.refreshTokenHash) {
      throw new InvalidRefreshTokenException();
    }

    const matchesStored = await verifyRefreshToken(
      dto.refreshToken,
      user.refreshTokenHash,
    );
    if (!matchesStored) {
      throw new InvalidRefreshTokenException();
    }

    const tokens = await this.issueTokens(user);
    await this.usersService.setRefreshTokenHash(
      user.id,
      await hashRefreshToken(tokens.refreshToken),
    );

    return { ...tokens, user: this.toPublicUser(user) };
  }

  /** Invalida la sesión: el refresh guardado deja de existir. */
  async logout(userId: string): Promise<void> {
    await this.usersService.setRefreshTokenHash(userId, null);
  }
}
