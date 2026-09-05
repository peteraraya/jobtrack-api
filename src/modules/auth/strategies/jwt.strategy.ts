import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration.js';
import { UsersService } from '../../users/users.service.js';
import type { AuthedUser } from '../interfaces/authed-user.interface.js';
import type { JwtPayload } from '../interfaces/jwt-payload.interface.js';

/**
 * Estrategia passport-jwt: valida el access token de cada request.
 *
 * validate() re-consulta al usuario por id: si fue borrado o su rol cambió,
 * el acceso se revoca al instante (trade-off: 1 query por request, a cambio
 * de revocabilidad real). El payload rol no es la fuente de verdad final.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<Env, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthedUser> {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return { id: user.id, email: user.email, role: user.role };
  }
}
