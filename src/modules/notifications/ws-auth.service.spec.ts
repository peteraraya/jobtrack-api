import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { WsAuthService } from './ws-auth.service.js';
import { UsersService } from '../users/users.service.js';
import type { Socket } from 'socket.io';

const USER = { id: 'u1', email: 'a@b.c', role: 'user' as const };

function fakeSocket(options: {
  authToken?: unknown;
  header?: unknown;
}): Socket {
  const handshake: Record<string, unknown> = { auth: {}, headers: {} };
  if (options.authToken !== undefined) {
    (handshake.auth as Record<string, unknown>).token = options.authToken;
  }
  if (options.header !== undefined) {
    (handshake.headers as Record<string, unknown>).authorization =
      options.header;
  }
  return { handshake } as never;
}

describe('WsAuthService', () => {
  let service: WsAuthService;
  let jwtService: { verifyAsync: ReturnType<typeof vi.fn> };
  let usersService: { findById: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsAuthService,
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        { provide: UsersService, useValue: { findById: vi.fn() } },
      ],
    }).compile();

    service = module.get(WsAuthService);
    jwtService = module.get(JwtService);
    usersService = module.get(UsersService);
  });

  it('rechaza conexión sin token', async () => {
    await expect(service.authenticateSocket(fakeSocket({}))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rechaza token inválido o vencido', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

    await expect(
      service.authenticateSocket(fakeSocket({ authToken: 'bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza token válido de un usuario que ya no existe', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'ghost', jti: 'j' });
    usersService.findById.mockResolvedValue(null);

    await expect(
      service.authenticateSocket(fakeSocket({ authToken: 'valid' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(usersService.findById).toHaveBeenCalledWith('ghost');
  });

  it('autentica por handshake.auth.token', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: USER.id, jti: 'j' });
    usersService.findById.mockResolvedValue(USER);

    await expect(
      service.authenticateSocket(fakeSocket({ authToken: 'valid-token' })),
    ).resolves.toEqual(USER);
  });

  it('autentica por header Authorization Bearer', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: USER.id, jti: 'j' });
    usersService.findById.mockResolvedValue(USER);

    await expect(
      service.authenticateSocket(fakeSocket({ header: 'Bearer header-token' })),
    ).resolves.toEqual(USER);
  });
});
