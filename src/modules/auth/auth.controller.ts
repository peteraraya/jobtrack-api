import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import {
  AUTH_THROTTLE_LIMIT,
  AUTH_THROTTLE_TTL,
} from './auth-throttle.const.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import type { AuthedUser } from './interfaces/authed-user.interface.js';

/**
 * Auth:
 * - register/login son PÚBLICOS pero con rate limit estricto (anti fuerza bruta).
 * - refresh es público (por eso el refresh token es rotable y hasheado).
 * - logout y me requieren access token.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: AUTH_THROTTLE_TTL, limit: AUTH_THROTTLE_LIMIT } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { ttl: AUTH_THROTTLE_TTL, limit: AUTH_THROTTLE_LIMIT } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  logout(@CurrentUser() user: AuthedUser) {
    return this.authService.logout(user.id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthedUser) {
    return user;
  }
}
