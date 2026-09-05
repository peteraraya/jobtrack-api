# Módulo 1 — Módulos, controladores, providers e inyección de dependencias

> **Estado:** ✅ Completo · **Duración estimada:** 5–7 días
> **Rama de git sugerida:** `module-01-foundations`

## Conceptos clave

- **Inyección de dependencias (DI):** cómo el contenedor de IoC de Nest resuelve providers por token; diferencia entre inyectar por clase vs. por token custom (`@Inject('TOKEN')`).
- **Scopes de provider:** `DEFAULT` (singleton), `REQUEST`, `TRANSIENT` — cuándo usar cada uno y su costo en performance.
- **Módulos:** `imports`, `exports`, `providers`, `controllers`; módulos dinámicos (`forRoot`/`forRootAsync`) vs. estáticos.
- **Controladores:** solo reciben request, delegan y devuelven response — cero lógica de negocio aquí.
- Patrón **Controller → Service → Repository** de Nest.
- **DIP (SOLID):** el service depende de una interfaz de repositorio, no de una implementación concreta.

## Lo que se implementó

### 1. CRUD completo en memoria: `companies`

Módulo con patrón **Controller → Service → Repository** y **DIP**: el service depende de la interfaz `CompaniesRepository`, implementada hoy por `InMemoryCompaniesRepository` (se reemplazará por el ORM en el Módulo 3 sin tocar la lógica de negocio).

```ts
// companies.repository.ts — el "puerto"
export abstract class CompaniesRepository {
  abstract findAll(): Company[];
  abstract findById(id: string): Company | null;
  abstract create(data: {
    name: string;
    website?: string;
    location?: string;
  }): Company;
  abstract update(
    id: string,
    data: { name?: string; website?: string; location?: string },
  ): Company | null;
  abstract delete(id: string): boolean;
}
```

```ts
// companies.module.ts — el provider se registra por interfaz
@Module({
  controllers: [CompaniesController],
  providers: [
    CompaniesService,
    { provide: CompaniesRepository, useClass: InMemoryCompaniesRepository },
  ],
  exports: [CompaniesService], // ← se reutiliza desde JobOffersModule
})
export class CompaniesModule {}
```

Se creó además la entidad `Company`, los DTOs `CreateCompanyDto`/`UpdateCompanyDto`, el service con `NotFoundException` para recursos ausentes, y el controller con los 5 verbos CRUD. Todo dentro de la misma carpeta del feature.

### 2. `job-offers` importa `companies` (practice de `exports`/`imports`)

`JobOffersModule` importa `CompaniesModule` y reutiliza **`CompaniesService`** para validar que `companyId` exista antes de crear/actualizar una oferta:

```ts
// job-offers.module.ts
@Module({
  imports: [CompaniesModule], // ← reutiliza CompaniesService
  controllers: [JobOffersController],
  providers: [JobOffersService /* ... */],
})
export class JobOffersModule {}
```

```ts
// job-offers.service.ts
constructor(
  @Inject(JOB_SOURCE_CONFIG) private readonly jobSourceConfig: JobSourceConfig,
  private readonly companiesService: CompaniesService, // ← de otro módulo
  private readonly jobOffersRepository: JobOffersRepository,
) {}

create(dto: CreateJobOfferDto): JobOffer {
  this.companiesService.findById(dto.companyId); // valida que exista
  const source = this.extractSource(dto.sourceUrl);
  this.enforceSourceLimit(source);
  return this.jobOffersRepository.create({ ...dto, source });
}
```

### 3. Reto entrevista — token custom `JOB_SOURCE_CONFIG` (patrón puerto)

El service **no conoce** de dónde sale la configuración (esto es una decisión del módulo). Se define una interfaz `JobSourceConfig`, un token y un **factory provider** que lee `ConfigService` SOLO en el módulo:

```ts
// job-source.config.ts
export const JOB_SOURCE_CONFIG = 'JOB_SOURCE_CONFIG' as const;

export interface JobSourceConfig {
  maxResultsPerSource: number;
  sources: string[];
}

export function createJobSourceConfig(
  configService: ConfigService<Env, true>,
): JobSourceConfig {
  const sources = configService
    .get('JOB_SOURCES', { infer: true })
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter((source) => source.length > 0);

  return {
    maxResultsPerSource: configService.get('JOB_MAX_RESULTS_PER_SOURCE', {
      infer: true,
    }),
    sources,
  };
}
```

```ts
// job-offers.module.ts — el wiring queda en el módulo
providers: [
  JobOffersService,
  { provide: JobOffersRepository, useClass: InMemoryJobOffersRepository },
  {
    provide: JOB_SOURCE_CONFIG,
    inject: [ConfigService],
    useFactory: createJobSourceConfig,
  },
],
```

**Para qué sirve:** el límite de ofertas por fuente de scraping es una regla de negocio real. En `POST /job-offers`, la fuente se deriva del hostname del `sourceUrl`; si es una fuente de scraping permitida (ej. `linkedin.com`) y ya alcanzó `maxResultsPerSource`, la request se rechaza con 409:

```bash
# con JOB_MAX_RESULTS_PER_SOURCE=10
POST /job-offers  (11ª oferta de linkedin.com)
→ 409 Conflict: Source "linkedin.com" already has 10 job offers (limit: 10)

POST /job-offers  (oferta de acme.com/careers — fuente no listada)
→ 200 OK, source: "manual"  # no aplica límite
```

### 4. Reto — ¿qué pasa si dos módulos definen el mismo provider sin exportarlo?

En Nest, cada módulo tiene **su propio ámbito de providers**. Si `ModuleA` y `ModuleB` definen el mismo class provider y ninguno lo exporta:

- Cada módulo obtiene su **propia instancia** (dos instancias distintas, no comparten estado).
- **No hay error de arranque** — el contenedor no se queja porque para cada módulo el token es local.
- El problema aparece si querés **compartir estado**: un `JobOffersService` de `ModuleA` no ve las ofertas creadas desde `ModuleB`.

**El error real** (si definís el mismo provider en dos módulos y ambos **lo exportan** hacia un tercer módulo que lo importa) es:

```bash
Nest cannot resolve dependencies of the XProvider (?, ...). Please make sure that
the argument ... at index [0] is available in the XModule context.
```

→ Es el escenario de **provider duplicado sin exportar**: el módulo consumidor no puede resolver el token porque el token se exportó dos veces con orígenes distintos. La solución correcta es **definir el provider una sola vez** (SRP/encapsulamiento de módulos) y solo **exportar** lo que otro módulo necesita.

**Regla práctica:** nunca definas un provider en un módulo que pertenece a otro — rompe el encapsulamiento y genera errores difíciles de diagnosticar.

## Mejores prácticas aplicadas

- ✅ **SRP:** `JobOffersService` solo gestiona ofertas; las empresas viven en `CompaniesService`, la config de fuentes en un factory provider separado.
- ✅ **DIP:** `JobOffersService` y `CompaniesService` dependen de la interfaz `*Repository` → el Módulo 3 reemplaza el adaptador in-memory por el ORM sin tocar los services.
- ✅ **Exports explícitos:** `CompaniesModule` exporta solo `CompaniesService`.
- ✅ Controllers "flacos": cero lógica de negocio, solo delegan.
- ✅ Tests unitarios de los services (15 tests) con dependencias mockeadas.

## Verificación del entregable

```bash
npm run test          # 15 tests → all passed
npm run lint          # 0 warnings, 0 errors
npm run start:dev     # arranca sin errores circulares (grafo de DI sano)

# Smoke test del CRUD
curl -X POST localhost:3000/companies -H 'Content-Type: application/json' \
  -d '{"name":"Acme","website":"https://acme.com"}'
curl -X POST localhost:3000/job-offers -H 'Content-Type: application/json' \
  -d '{"companyId":"<id>","title":"Backend Dev","sourceUrl":"https://linkedin.com/jobs/1"}'
```

## Siguiente módulo

[Módulo 2 — DTOs, validación, pipes y manejo de errores](/guide/module-02)
