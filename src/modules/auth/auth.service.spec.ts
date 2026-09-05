import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception.js';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception.js';
import { hashPassword, hashRefreshToken } from './crypto.js';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;

  const now = 1_700_000_000_000;

  const userRow = {
    id: '3f7a5a59-cf45-4832-a5e5-b6e36319e4b0',
    email: 'ana@jobtrack.dev',
    passwordHash: 'not-used-in-mocks',
    role: 'user' as const,
    refreshTokenHash: null,
    createdAt: new Date(now),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: vi.fn(),
            findById: vi.fn(),
            create: vi.fn(),
            setRefreshTokenHash: vi.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { signAsync: vi.fn(), verifyAsync: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn((key: string) =>
              key === 'JWT_REFRESH_EXPIRATION' ? '7d' : '15m',
            ),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);

    vi.spyOn(jwtService, 'signAsync').mockResolvedValue(
      'signed-token' as never,
    );
  });

  describe('register', () => {
    it('crea el usuario con rol user, emite tokens y guarda el refresh HASHEADO', async () => {
      vi.spyOn(usersService, 'findByEmail').mockResolvedValue(null);
      vi.spyOn(usersService, 'create').mockResolvedValue({
        ...userRow,
        refreshTokenHash: null,
      } as never);

      const result = await service.register({
        email: 'ana@jobtrack.dev',
        password: 'password123',
      });

      expect(result.user.role).toBe('user');
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');

      expect(usersService.create).toHaveBeenCalledWith({
        email: 'ana@jobtrack.dev',
        passwordHash: expect.any(String),
        role: 'user',
      });
      // Nunca se guarda el token plano: se guarda su hash.
      expect(usersService.setRefreshTokenHash).toHaveBeenCalledWith(
        userRow.id,
        expect.any(String),
      );
      const storedHash = (
        usersService.setRefreshTokenHash as ReturnType<typeof vi.fn>
      ).mock.calls[0][1] as string;
      expect(storedHash).not.toBe('signed-token');
    });

    it('devuelve 409 si el email ya está registrado', async () => {
      vi.spyOn(usersService, 'findByEmail').mockResolvedValue(userRow as never);

      await expect(
        service.register({
          email: 'ana@jobtrack.dev',
          password: 'password123',
        }),
      ).rejects.toThrow(ConflictException);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('valida la contraseña y rota el refresh', async () => {
      const inserted = await hashRefreshToken('refresh-token-abc');
      vi.spyOn(usersService, 'findByEmail').mockResolvedValue({
        ...userRow,
        passwordHash: await hashPassword('password123'),
        refreshTokenHash: inserted,
      } as never);

      const result = await service.login({
        email: 'ana@jobtrack.dev',
        password: 'password123',
      });

      expect(result.user.email).toBe('ana@jobtrack.dev');
      expect(usersService.setRefreshTokenHash).toHaveBeenCalled();
    });

    it('401 con credenciales inválidas', async () => {
      vi.spyOn(usersService, 'findByEmail').mockResolvedValue({
        ...userRow,
        passwordHash: await hashPassword('password-correct'),
      } as never);

      await expect(
        service.login({
          email: 'ana@jobtrack.dev',
          password: 'wrong-password',
        }),
      ).rejects.toThrow(InvalidCredentialsException);
      expect(usersService.setRefreshTokenHash).not.toHaveBeenCalled();
    });

    it('401 si el email no existe (mismo código que credenciales inválidas)', async () => {
      vi.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@jobtrack.dev', password: 'password123' }),
      ).rejects.toThrow(InvalidCredentialsException);
    });
  });

  describe('refresh (rotation)', () => {
    it('rota: emite un par nuevo y reemplaza el hash almacenado', async () => {
      const storedRefresh = 'refresh-token-first-abc';
      vi.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: userRow.id,
        email: userRow.email,
        role: userRow.role,
      } as never);
      vi.spyOn(usersService, 'findById').mockResolvedValue({
        ...userRow,
        refreshTokenHash: await hashRefreshToken(storedRefresh),
      } as never);

      // El segundo sign devuelve un token distinto (el nuevo refresh).
      (jwtService.signAsync as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('access-token-new')
        .mockResolvedValueOnce('refresh-token-new');

      const result = await service.refresh({ refreshToken: storedRefresh });

      expect(result.refreshToken).toBe('refresh-token-new');
      expect(usersService.setRefreshTokenHash).toHaveBeenCalledWith(
        userRow.id,
        expect.not.stringMatching(/^refresh-token-new$/),
      );
    });

    it('401 si el token no es un JWT válido', async () => {
      vi.spyOn(jwtService, 'verifyAsync').mockRejectedValue(
        new Error('jwt expired'),
      );

      await expect(
        service.refresh({ refreshToken: 'garbage' }),
      ).rejects.toThrow(InvalidRefreshTokenException);
    });

    it('401 si el refresh ya fue rotado (reutilización)', async () => {
      vi.spyOn(jwtService, 'verifyAsync').mockResolvedValue({
        sub: userRow.id,
        email: userRow.email,
        role: userRow.role,
      } as never);
      // El hash almacenado corresponde a OTRO token (ya fue usado y rotado).
      vi.spyOn(usersService, 'findById').mockResolvedValue({
        ...userRow,
        refreshTokenHash: await hashRefreshToken('refresh-token-rotated'),
      } as never);

      await expect(
        service.refresh({ refreshToken: 'refresh-token-stale' }),
      ).rejects.toThrow(InvalidRefreshTokenException);
      expect(usersService.setRefreshTokenHash).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('borra el hash almacenado (invalida la sesión)', async () => {
      await service.logout(userRow.id);

      expect(usersService.setRefreshTokenHash).toHaveBeenCalledWith(
        userRow.id,
        null,
      );
    });
  });
});
