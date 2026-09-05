# Código fuente — Módulo 4

Código real del proyecto al cierre del Módulo 4: auth JWT, guards, RBAC, refresh rotation y ownership.

## `src/modules/auth/crypto.ts`

Hashing de contraseñas y refresh tokens. El detalle fino: bcrypt trunca su entrada a **72 bytes**; dos JWTs que difieren solo en `jti`/firma comparten el prefijo y colisionarían. Se pasa el token por **SHA-256** antes de bcrypt.

```ts
import { createHash } from 'node:crypto';
import { compare, hash } from 'bcryptjs';

const PASSWORD_ROUNDS = 12;
const TOKEN_ROUNDS = 8;

// bcrypt solo usa los primeros 72 bytes de su entrada. Dos JWTs que difieren
// solo en jti/firma comparten header+payload (~los primeros bytes) y bcrypt
// los colisiona. Primero SHA-256 (32 bytes < 72) y sobre el digest → el hash
// cambia ante CUALQUIER cambio del token, por mínimo que sea.
function tokenDigest(refreshToken: string): string {
  return createHash('sha256').update(refreshToken, 'utf8').digest('hex');
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}

export function hashRefreshToken(refreshToken: string): Promise<string> {
  return hash(tokenDigest(refreshToken), TOKEN_ROUNDS);
}

export function verifyRefreshToken(
  refreshToken: string,
  hashToCompare: string,
) {
  return compare(tokenDigest(refreshToken), hashToCompare);
}

// Hash tonto cacheado: cuando el email no existe igual ejecutamos un verify
// bcrypt de costo similar para no dejar huella temporal (user enumeration).
let dummyHash: string | null = null;

export async function dummyPasswordVerify(): Promise<void> {
  dummyHash ??= await hash('timing-equalizer', PASSWORD_ROUNDS);
  await compare('timing-equalizer', dummyHash);
}
```

## `src/modules/auth/auth.service.ts`

Contiene el flujo de tokens: emisión con `jti` único y rotation con reemplazo del hash.

```ts
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

async logout(userId: string): Promise<void> {
  await this.usersService.setRefreshTokenHash(userId, null);
}
```

## `src/modules/auth/strategies/jwt.strategy.ts`

Revalida en cada request para revocabilidad real (rol/cuenta vigente), a costa de 1 query por request.

```ts
async validate(payload: JwtPayload): Promise<AuthedUser> {
  const user = await this.usersService.findById(payload.sub);
  if (!user) {
    throw new UnauthorizedException('User no longer exists');
  }
  return { id: user.id, email: user.email, role: user.role };
}
```

## `src/modules/users/typeorm-users.repository.ts`

Puerto `UsersRepository` + adaptador TypeORM. El `23505` de email único se mapea a `409 Conflict`.

```ts
export class TypeOrmUsersRepository extends UsersRepository {
  override async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
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
```

## `src/modules/auth/auth.controller.ts`

Los 5 endpoints de la sesión. Register/login llevan el `@Throttle` estricto (constants leídas a tiempo de importación).

```ts
@Public()
@Throttle({ default: { ttl: AUTH_THROTTLE_TTL, limit: AUTH_THROTTLE_LIMIT } })
@Post('register')
async register(@Body() dto: RegisterDto) {
  return this.authService.register(dto);
}

@Get('me')
async me(@CurrentUser() user: AuthedUser) {
  return user;
}
```

## `src/modules/applications/applications.service.ts`

Ownership verificado en el service con el `actor` del token, nunca del body.

```ts
async updateStatus(
  applicationId: string,
  actor: AuthedUser,
  dto: UpdateApplicationStatusDto,
): Promise<Application> {
  const application = await this.applicationsRepository.findById(applicationId);
  if (!application) {
    throw new ApplicationNotFoundException(applicationId);
  }
  const isOwner = application.userId === actor.id;
  const isAdmin = actor.role === 'admin';
  if (!isOwner && !isAdmin) {
    throw new ForbiddenException();   // 403 aunque adivines el ID ajeno
  }
  return this.applicationsRepository.updateStatus(applicationId, dto.status);
}
```

## `src/common/decorators/` y `src/common/guards/`

Metadata para marcar rutas y consumir el usuario autenticado:

```ts
// public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

// current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<{ user?: AuthedUser }>().user,
);

// jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }
}

// roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const { user } = context.switchToHttp().getRequest<{ user: AuthedUser }>();
    return roles.includes(user.role); // roles declarados deben incluir el rol
  }
}
```

## `src/modules/users/entities/user.entity.ts`

La columna nueva del Módulo 4 (agregada por la migración `AddRefreshTokenHash`):

```ts
@Column({ name: 'refresh_token_hash', type: 'varchar', length: 255, nullable: true })
refreshTokenHash: string | null;
```

## `src/database/migrations/1788561161268-AddRefreshTokenHash.ts`

Migración posterior a `SchemaInit`: solo agrega la columna. Texto de la clase generada por TypeORM editado para dejar **solo** lo que cambió (el diff automático agregaba drops/recreates no-op por diferencias de formato de índice).

```ts
export class AddRefreshTokenHash1788561161268 implements MigrationInterface {
  name = 'AddRefreshTokenHash1788561161268';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Módulo 4: hash del refresh token rotable (dentro de User en runtime).
    await queryRunner.query(
      `ALTER TABLE "user" ADD "refresh_token_hash" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "refresh_token_hash"`,
    );
  }
}
```
