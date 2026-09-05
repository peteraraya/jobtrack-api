import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { UsersService } from '../users/users.service.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface.js';
import type { AuthedUser } from '../auth/interfaces/authed-user.interface.js';

/**
 * Módulo 8 — autenticación del HANDSHAKE de Socket.IO.
 *
 * Reutiliza el mismo contrato que el JWT HTTP: misma JWT_SECRET (JwtService)
 * y re-consulta del usuario por id en cada conexión, así un usuario borrado o
 * con rol cambiado pierde el canal al instante. El token viaja en
 * `handshake.auth.token` (recomendado por socket.io-client) o en el header
 * `Authorization: Bearer <token>`.
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async authenticateSocket(client: Socket): Promise<AuthedUser> {
    const token = extractWsToken(client);
    if (!token) {
      throw new UnauthorizedException('Missing WebSocket token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}

function extractWsToken(client: Socket): string | null {
  const fromAuth = client.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  const authorization = client.handshake.headers?.authorization;
  if (
    typeof authorization === 'string' &&
    authorization.startsWith('Bearer ')
  ) {
    const bearer = authorization.slice('Bearer '.length).trim();
    if (bearer.length > 0) return bearer;
  }
  return null;
}
