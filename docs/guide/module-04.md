# Módulo 4 — Autenticación (JWT) y autorización (Guards, RBAC)

> **Estado:** ✅ Completo · **Duración estimada:** 7–10 días
> **Rama de git sugerida:** `module-04-auth`

## Conceptos clave

- **Guards:** se ejecutan antes que el handler. Separá guard de **autenticación** (¿quién sos? → `JwtAuthGuard`) de guard de **autorización** (¿qué podés hacer? → `RolesGuard`). No se mezclan.
- JWT de vida corta (access token) + refresh token de vida larga, **rotado en cada uso** y almacenado **hasheado** en DB.
- `Passport` + estrategia JWT integrada a Nest (`@nestjs/passport`, `passport-jwt`).
- RBAC (roles) vs. verificación de **ownership** (permisos dependientes del recurso: solo el dueño de la `Application` puede editarla).
- Decoradores custom (`@CurrentUser()`, `@Public()`, `@Roles('admin')`) y metadata reflection.
- **Rate limiting** (`@nestjs/throttler`): global generoso + estricto en login/register.

## Lo que se implementó

### 1. Elección del hasher: `bcryptjs` (y por qué no argon2)

Para contraseñas el candidato natural era **argon2**, pero sus bindings nativos (node-gyp) complican Windows y el build de Docker. Elegí **`bcryptjs`**: la misma familia bcrypt, implementación **100% JS**, zero dependencias nativas. Costo de trabajo: `PASSWORD_ROUNDS = 12` para contraseñas (login), `TOKEN_ROUNDS = 8` para refresh tokens (se verifican en cada `POST /auth/refresh`, se quiere más velocidad).

```ts
// src/modules/auth/crypto.ts
const PASSWORD_ROUNDS = 12;
const TOKEN_ROUNDS = 8;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}
```

**Anti user-enumeration:** si el email no existe, igual se ejecuta un `compare` de costo similar sobre un hash dummy cacheado — la huella temporal de login es idéntica exista o no la cuenta:

```ts
let dummyHash: string | null = null;
export async function dummyPasswordVerify(): Promise<void> {
  dummyHash ??= await hash('timing-equalizer', PASSWORD_ROUNDS);
  await compare('timing-equalizer', dummyHash);
}
```

### 2. El bug sutil: bcrypt trunca a 72 bytes (y el refresh rotation lo destapó)

`bcrypt` solo usa los **primeros 72 bytes** de su entrada. Dos JWTs que difieran solo en un claim tardío (p.ej. `jti`) o en la firma — que va al final — comparten header+payload y colisionan en bcrypt. Resultado: tras rotar, el hash almacenado seguía coincidiendo con el refresh **viejo** → la reutilización no daba 401. Lo destapó el e2e `rotar invalida el refresh anterior`.

La solución estándar: **hashear el token con SHA-256 antes de bcrypt**. El digest (64 chars hex < 72 bytes) es sensible a _cualquier_ bit del token y sigue con costo bcrypt:

```ts
import { createHash } from 'node:crypto';

function tokenDigest(refreshToken: string): string {
  return createHash('sha256').update(refreshToken, 'utf8').digest('hex');
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
```

Y para que dos firmas del **mismo segundo** no produzcan tokens idénticos (payload igual + `iat/exp` iguales), el payload lleva un **`jti` único** por firma:

```ts
const payload: JwtPayload = {
  sub: user.id,
  email: user.email,
  role: user.role,
  jti: randomUUID(), // claim único por firma
};
```

### 3. Registro y login: flujo completo

`POST /auth/register` crea el usuario con `role: 'user'` (los `admin` se promueven por seed), emite el par de tokens y guarda el hash del refresh. `POST /auth/login` verifica y, si no existe el email, corre el `dummyPasswordVerify()`.

```bash
→ POST /auth/login  { "email": "demo@jobtrack.dev", "password": "Demo1234!" }
← 201 { "accessToken": "eyJ...", "refreshToken": "eyJ...", "user": { "id", "email", "role" } }
```

El módulo `JwtModule.registerAsync` lee `JWT_SECRET` / `JWT_EXPIRATION` / `JWT_REFRESH_EXPIRATION` desde el env (validado con Zod al arrancar). El access token usa la expiración por defecto (15m en dev) y el refresh se firma con `JWT_REFRESH_EXPIRATION` (7d).

### 4. `JwtStrategy`: revocabilidad real por re-consulta

La estrategia `passport-jwt` **no confía** solo en el payload firmado: `validate()` re-consulta el usuario por `sub` en cada request. Si la cuenta fue borrada o el rol cambió, el acceso se revoca al instante. Trade-off explícito: **1 query por request** a cambio de no depender del rol congelado en el token.

```ts
// src/modules/auth/strategies/jwt.strategy.ts
async validate(payload: JwtPayload): Promise<AuthedUser> {
  const user = await this.usersService.findById(payload.sub);
  if (!user) {
    throw new UnauthorizedException('User no longer exists');
  }
  return { id: user.id, email: user.email, role: user.role };
}
```

### 5. Guards componibles: autenticación ≠ autorización

- `JwtAuthGuard` (`AuthGuard('jwt')`): responde **401** sin token o con token inválido.
- `RolesGuard`: lee `@Roles(...)` del handler y compara contra `req.user.role`; sin rol declarado deja pasar. No-autorizado → **403**.
- `@Public()` marca rutas que evitan el JwtAuthGuard (catálogo público, health).

El orden global en `app.module.ts` — el mismo para toda la app (también e2e):

```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard },
{ provide: APP_GUARD, useClass: RolesGuard },
```

> Nota: `JwtAuthGuard` marcado con `@Public()` retorna `true` temprano; `RolesGuard` idem. Por eso las rutas públicas siguen funcionando con ambos guards globales.

### 6. Refresh token rotation

Cada `POST /auth/refresh` **valida el token contra el hash almacenado**, emite un par **nuevo** y **reemplaza el hash**. Si alguien reutiliza un refresh ya rotado, el hash almacenado ya no coincide → **401**.

```ts
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
```

- Nunca se guarda el token plano: la columna `refresh_token_hash` (migración `AddRefreshTokenHash`) guarda `bcrypt(sha256(token))`.
- `POST /auth/logout` simplemente pone el hash en `null` → la sesión muere en DB.
- Reto de entrevista resuelto: **robar/reutilizar un refresh capturado queda invalidado en el siguiente uso**.

### 7. Ownership en `PATCH /applications/:id` (ABAC puntual)

RBAC no alcanza para "solo el dueño edita su postulación". La verificación va en el **service**, con el `userId` que viene del **token** (`@CurrentUser()`), nunca del body:

```ts
// applications.service.ts
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

Además, `POST /applications` **ya no recibe `userId` en el body**: lo toma del token. Y `GET /applications` hace scope por usuario (el admin ve todas). El e2e `el intruso recibe 403 aunque adivine el ID de la aplicación ajena` prueba justamente ese caso.

### 8. Rate limiting: global generoso + estricto en auth

`ThrottlerModule.forRootAsync` (v6) — detalle de API: `@Throttle` se importa de `@nestjs/throttler` (no de `@nestjs/common`) y `forRootAsync` exige devolver `{ throttlers: [...], imports: [] }`:

```ts
ThrottlerModule.forRootAsync({
  imports: [],
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    throttlers: [
      {
        name: 'default',
        ttl: config.getOrThrow('THROTTLE_TTL'),     // 60_000 ms
        limit: config.getOrThrow('THROTTLE_LIMIT'), // 100 req
      },
    ],
  }),
}),
```

Y en login/register un límite estricto medido por handler:

```ts
@Throttle({ default: { ttl: AUTH_THROTTLE_TTL, limit: AUTH_THROTTLE_LIMIT } })
@Public()
@Post('login')
async login(@Body() dto: LoginDto) { ... }
```

Los límites de auth se leen **a tiempo de importación** (constantes `AUTH_THROTTLE_LIMIT`/`AUTH_THROTTLE_TTL` en `auth-throttle.const.ts`); por eso `main.ts` carga `dotenv/config` **antes** que cualquier módulo y vitest usa `test/env.setup.ts`. Exceder el límite responde **`429 Too Many Requests`**.

### 9. RBAC en el dominio: catálogo público, escritura de admin

- `GET /companies`, `GET /companies/:id`, `GET /job-offers`, `GET /job-offers/:id` y `/health` → `@Public()`.
- `POST /companies`, `PATCH /companies/:id`, `DELETE /companies/:id`, `POST /job-offers`, … → `@Roles('admin')`.
- `users => user/applications` → ruta estándar (JWT): el usuario pesca sus propias postulaciones.

### 10. Seguridad de transporte: helmet + CORS por whitelist

```ts
// src/configure-app.ts
app.use(helmet());
app.enableCors({
  origin: parseOrigins(configService.getOrThrow('CORS_ORIGINS')),
});
```

`CORS_ORIGINS` es una lista separada por comas (`http://localhost:5173`); vacío se interpreta como `true` (todo origen) **solo** en desarrollo.

## Mejores prácticas aplicadas

- ✅ Contraseñas y refresh tokens: bcrypt **jamás** en plano cero (solo hash en DB).
- ✅ Refresh token con **SHA-256 + bcrypt**: correcto bajo el truncado de 72 bytes de bcrypt (bug real encontrado en e2e).
- ✅ **Rotation + invalidación en DB**: el refresh viejo muere aunque estuviera firmado (revocación server-side).
- ✅ `jti` único por firma: dos tokens del mismo segundo nunca son idénticos.
- ✅ Anti **user enumeration** por timing en login.
- ✅ Auth y autorización en **guards separados** y componibles (`@Public`, `@Roles`).
- ✅ Ownership verificado en el **service** con el id del **token**, nunca del body.
- ✅ Throttling **estricto en auth** + global genérico; 429 explícito.
- ✅ `helmet()` + CORS por whitelist.
- ✅ Los **casos negativos** (401/403/429/reutilización) están cubiertos por e2e.

## Verificación del entregable

```bash
npm run build                 # compila sin errores
npm run lint                  # 0 warnings, 0 errors
npm test                      # 39 tests unitarios → all passed
npm run test:e2e              # 36 tests e2e contra Postgres real → all passed
npm run db:migration:run      # SchemaInit + AddRefreshTokenHash aplicadas
npm run db:seed               # { companies: 3, offers: 4, users: 2, applications: 1 }
```

```bash
# Cuentas del seed: demo@jobtrack.dev / Demo1234!  ·  admin@jobtrack.dev / Admin1234!
export TOKEN=$(curl -s localhost:3000/auth/login -X POST \
  -H 'content-type: application/json' \
  -d '{"email":"demo@jobtrack.dev","password":"Demo1234!"}' | jq -r .accessToken)

curl -H "Authorization: Bearer $TOKEN" localhost:3000/auth/me   # → el usuario
curl localhost:3000/applications                                  # → 401 sin token
curl -X POST localhost:3000/companies -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"X"}' -H 'content-type: application/json'            # → 403 (rol user)
curl -X POST localhost:3000/auth/login -d '{"email":"demo@jobtrack.dev","password":"Demo1234!"}' \
  -H 'content-type: application/json'                              # → 429 al pasarse del límite
```

Anterior: [Módulo 3](/guide/module-03) · Siguiente: [Módulo 5](/guide/module-05)
