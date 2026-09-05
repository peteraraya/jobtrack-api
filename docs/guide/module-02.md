# Módulo 2 — DTOs, validación, pipes y manejo de errores

> **Estado:** ✅ Completo · **Duración estimada:** 5–7 días
> **Rama de git sugerida:** `module-02-validation`

## Conceptos clave

- **DTOs** como contrato de entrada — el body nunca toca el service sin validar y sin normalizar.
- **Pipes:** pipe global de validación vs. pipes custom (`TrimPipe`) — y el **orden de ejecución** entre ambos.
- **Filtros de excepción:** excepciones de dominio propias (`JobOfferNotFoundException`) vs. `HttpException` genérica.
- Diferencia entre error de **validación** (400, culpa del cliente) y error de **negocio** (409, la request es válida pero la operación no procede).

## Lo que se implementó

### 1. Zod como fuente única de verdad: DTO = clase + `static schema`

Se mantiene **Zod** (consistente con la validación de env vars del Módulo 0, sin agregar `class-validator`). Cada DTO expone un esquema propio; el pipe lo lee por metadatos en runtime:

```ts
// companies/dto/create-company.dto.ts
export const CreateCompanySchema = z
  .object({
    name: z.string().min(1).max(120),
    website: z.string().url().max(255).optional(),
    location: z.string().max(120).optional(),
  })
  // Equivale a forbidNonWhitelisted: rechaza campos desconocidos.
  .strict();

export class CreateCompanyDto {
  static schema = CreateCompanySchema;
  name: string;
  website?: string;
  location?: string;
}
```

> `.strict()` en Zod = `forbidNonWhitelisted: true` de `ValidationPipe`. Los campos no declarados se **rechazan** (no se descartan silenciosamente).

Se aplicó a los 6 DTOs: `Create/UpdateCompany`, `Create/UpdateJobOffer`, `CreateApplication`. El flujo del `stack` de ofertas también queda validado (array de strings con límite).

### 2. `ZodValidationPipe` global — validación con respuesta consistente

```ts
// common/pipes/zod-validation.pipe.ts
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const metatype = metadata.metatype as { schema?: ZodType } | undefined;
    const schema = metatype?.schema;
    if (!schema) return value; // params sin DTO pasan igual

    const result = schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues as ZodIssueWithKeys[];
      const errors = issues.map((issue) => ({
        field:
          issue.path.length > 0
            ? issue.path.join('.')
            : (issue.keys?.join(',') ?? ''), // claves desconocidas → keys
        message: issue.message,
      }));
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        errors,
      });
    }
    return result.data; // retorna el dato PARSED (defaults, etc.)
  }
}
```

Detalle fino: en Zod 4 las claves desconocidas llegan con `path` vacío pero con `issue.keys` — por eso el `field` sale como `hack`, no `''`.

### 3. `TrimPipe` custom — normalización ANTES de validación (orden de pipes)

```ts
// common/pipes/trim.pipe.ts
@Injectable()
export class TrimPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') return value;
    return deepTrim(value); // trimea strings recursivamente (objetos y arrays)
  }
}
```

**El orden importa:** los pipes globales corren en el orden en que se registran. `TrimPipe` primero, `ZodValidationPipe` después:

```ts
// configure-app.ts
app.useGlobalPipes(new TrimPipe(), new ZodValidationPipe());
```

Así los esquemas asumen input ya limpio. Ocurre con trims también en arrays (`stack`), y es verificable en e2e:

```
POST /companies {"name":"  Acme  ","location":"  Santiago  "}
→ 201 {"id":"...","name":"Acme","location":"Santiago"}   # ya trimeado
```

### 4. `AllExceptionsFilter` global — log interno, respuesta segura

```ts
// common/filters/all-exceptions.filter.ts
@Catch() // sin argumentos = captura TODO
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    // ... decide body según tipo y SIEMPRE loguea el detalle interno ...
    response.status(body.status).json({
      statusCode: body.status,
      message: body.message,
      ...(body.errors === undefined ? {} : { errors: body.errors }),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

Reglas de oro aplicadas:

1. El **stack trace se loguea siempre** (observabilidad) pero **nunca llega al cliente**.
2. `HttpException` → se conserva su `status` y mensaje.
3. Errores "HTTP de facto" sin ser `HttpException` (p. ej. el **413 del body-parser**) → se mapean por `statusCode` en vez de caer en 500.
4. Errores desconocidos → 500 genérico (`Internal server error`) en producción; el mensaje real solo en dev/test.

### 5. Excepciones de dominio propias

`CompanyNotFoundException` y `JobOfferNotFoundException` heredan de `NotFoundException` (el cliente ve un 404 estándar) pero el código queda **semántico**:

```ts
export class JobOfferNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Job offer with id "${id}" not found`);
    this.name = 'JobOfferNotFoundException';
  }
}
```

Los services de `companies` y `job-offers` ahora las lanzan en vez de `new NotFoundException('...')` repetido.

### 6. Reto entrevista — `DuplicateApplicationException` → 409

Se creó el módulo **`applications`** en memoria: un usuario no puede postular dos veces a la misma oferta. La invariante es de **negocio** y se traduce a 409 sin filtrar detalles de implementación:

```ts
// applications/exceptions/duplicate-application.exception.ts
export class DuplicateApplicationException extends ConflictException {
  constructor(userId: string, jobOfferId: string) {
    super(`User "${userId}" already applied to job offer "${jobOfferId}"`);
    this.name = 'DuplicateApplicationException';
  }
}
```

```ts
// applications/applications.service.ts
apply(dto: CreateApplicationDto): Application {
  this.jobOffersService.findById(dto.jobOfferId);   // 404 si la oferta no existe
  if (this.applicationsRepository.existsByUserAndJobOffer(dto.userId, dto.jobOfferId)) {
    throw new DuplicateApplicationException(dto.userId, dto.jobOfferId);  // 409
  }
  return this.applicationsRepository.create(dto);
}
```

```bash
POST /applications {"userId":"...","jobOfferId":"..."}   # 201, status: "applied"
POST /applications {"userId":"...","jobOfferId":"..."}   # 409 Conflict (mismo par)
```

`ApplicationsModule` importa `JobOffersModule` (que **exporta** `JobOffersService`) — reuso de servicios entre módulos, como `companies → job-offers` en el Módulo 1.

### 7. Body size limit + límites en campos de texto (ReDoS/DoS)

- `configureApp`: `app.useBodyParser('json', { limit: '1mb' })` — body mayor devuelve **413** (el filtro lo mapea correctamente).
- Todos los strings con `.max(…)` en los esquemas: sin límite, un input de MBs dispara trabajo de costoso parsing (DoS/ReDoS).

### 8. `configureApp()` compartido entre runtime y e2e

La configuración de pipes/filtros/body-parser se extrajo a `src/configure-app.ts`, invocada por `main.ts` **y** por los tests e2e. Si los e2e no la llaman, los tests no ejercitan la misma pipeline que producción — clásica pregunta de entrevista:

```ts
const app = moduleFixture.createNestApplication();
configureApp(app); // ← obligatorio en e2e
await app.init();
```

## Contrato de errores (todas las respuestas de error)

| Campo        | Tipo                | Descripción                                         |
| ------------ | ------------------- | --------------------------------------------------- |
| `statusCode` | number              | Código HTTP (400, 404, 409, 413, 500...)            |
| `message`    | string              | Mensaje legible (sin stack, sin detalle interno)    |
| `errors`     | `[{field,message}]` | Solo en validación (400): qué campo falló y por qué |
| `path`       | string              | Ruta solicitada                                     |
| `timestamp`  | ISO string          | Hora del error                                      |

## Mejores prácticas aplicadas

- ✅ DTOs con **Zod** como fuente única de verdad (sin `class-validator`).
- ✅ `forbidNonWhitelisted` via `.strict()`: campos desconocidos → 400.
- ✅ `<V>Pipe` de validación global **consistente** con `PipeTransform`.
- ✅ `TrimPipe` → **orden de pipes** documentado y testeado.
- ✅ Filtro global con **2 reglas**: loguear todo, exponer lo mínimo.
- ✅ Excepciones de dominio con nombre semántico (`...NotFoundException`, `DuplicateApplicationException`).
- ✅ Body limit explícito + `max()` en texto libre.
- ✅ `configureApp` compartido entre runtime y e2e.
- ✅ Errores 400 (validación) vs. 409/404 (negocio) diferenciados.

## Verificación del entregable

```bash
npm run build         # compila sin errores
npm run lint          # 0 warnings, 0 errors (41 archivos)
npm run test          # 19 tests unitarios → all passed
npm run test:e2e      # 8 tests e2e (400/404/409/413) → all passed
```

Smoke test en runtime (`node dist/main.js`):

```bash
curl -X POST localhost:3000/companies -H 'Content-Type: application/json' \
  -d '{"name":"  Acme  ","hack":true}'          # → 400, errors: [{field:"hack",...}]
curl -X POST localhost:3000/companies -H 'Content-Type: application/json' \
  -d '{"name":"  Acme  ","location":"  Santiago  "}'  # → 201 name:"Acme"
# POST /applications dos veces con el mismo (userId, jobOfferId) → 409
# Body > 1MB → 413
```

## Siguiente módulo

[Módulo 3 — Persistencia: PostgreSQL](/guide/module-03)
