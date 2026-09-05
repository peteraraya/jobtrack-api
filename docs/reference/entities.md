# Entidades de dominio

Las 6 entidades del negocio, ya **mapeadas como entidades TypeORM** (Módulo 3) en `src/modules/*/entities/*.entity.ts`:

- Tabla por entidad con nombre en snake_case de la clase: `User → user`, `JobOffer → job_offer`, etc.
- PKs: `@PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })` (sin la extensión `uuid-ossp`).
- Relaciones declaradas **por nombre de entidad como string** (`@ManyToOne('company', ...)`) para convivir con ESM + `emitDecoratorMetadata`.

## `User`

Usuario de la plataforma (el buscador de empleo).

| Campo              | Tipo                | Notas                               |
| ------------------ | ------------------- | ----------------------------------- |
| `id`               | UUID                | PK                                  |
| `email`            | string              | Único, indexado                     |
| `passwordHash`     | string              | bcryptjs (nunca plano)              |
| `role`             | `'admin' \| 'user'` | RBAC (Módulo 4)                     |
| `refreshTokenHash` | string \| null      | Hash del refresh rotable (Módulo 4) |
| `createdAt`        | timestamp           |                                     |

## `Profile`

Perfil profesional: stack, años de experiencia, CV parseado.

| Campo               | Tipo     | Notas                                 |
| ------------------- | -------- | ------------------------------------- |
| `id`                | UUID     | PK                                    |
| `userId`            | UUID     | FK → `User`, `OneToOne`               |
| `stack`             | string[] | ej. `['NestJS', 'React', 'Postgres']` |
| `yearsOfExperience` | int      |                                       |
| `cvParsed`          | json     | Datos extraídos del CV                |

## `JobOffer`

Oferta laboral agregada (de scraping o carga manual).

| Campo         | Tipo      | Notas                                               |
| ------------- | --------- | --------------------------------------------------- |
| `id`          | UUID      | PK                                                  |
| `companyId`   | UUID      | FK → `Company`, `ManyToOne`                         |
| `title`       | string    |                                                     |
| `description` | text      |                                                     |
| `location`    | string    |                                                     |
| `stack`       | string[]  | Usado para matching con `Profile`                   |
| `sourceUrl`   | string    | **Único** — idempotencia del scraping (Módulo 7)    |
| `postedAt`    | timestamp | Indexado `(postedAt, id)` — filtro/orden/paginación |
| `slots`       | int       | Contador transaccional (Módulo 3), default 3        |

## `Application`

Postulación de un `User` a un `JobOffer`, con estado.

| Campo        | Tipo      | Notas                                                                    |
| ------------ | --------- | ------------------------------------------------------------------------ |
| `id`         | UUID      | PK                                                                       |
| `userId`     | UUID      | FK → `User`                                                              |
| `jobOfferId` | UUID      | FK → `JobOffer`                                                          |
| `status`     | enum      | `applied`, `interview`, `technical_test`, `offer`, `rejected` — indexado |
| `createdAt`  | timestamp |                                                                          |

**Restricciones:** `UNIQUE(userId, jobOfferId)` — un usuario no puede postular dos veces (Módulo 2, ahora garantizado por la base). `status` indexado.

## `Company`

Empresa asociada a una oferta.

| Campo       | Tipo         | Notas                        |
| ----------- | ------------ | ---------------------------- |
| `id`        | UUID         | PK                           |
| `name`      | string       |                              |
| `website`   | string       |                              |
| `location`  | string       |                              |
| `jobOffers` | `JobOffer[]` | `OneToMany` desde `JobOffer` |

## `Notification`

Notificación al usuario (nueva oferta relevante, cambio de estado).

| Campo       | Tipo              | Notas                              |
| ----------- | ----------------- | ---------------------------------- |
| `id`        | UUID              | PK                                 |
| `userId`    | UUID              | FK → `User`                        |
| `type`      | enum              | `new_offer`, `status_changed`, ... |
| `payload`   | json              | Datos de la notificación           |
| `readAt`    | timestamp \| null | Marca de lectura                   |
| `createdAt` | timestamp         |                                    |

## Diagrama de relaciones

```
User 1───1 Profile
User 1───N Application N───1 JobOffer
JobOffer N───1 Company
User 1───N Notification
```
