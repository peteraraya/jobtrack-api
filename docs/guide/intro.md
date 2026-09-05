# Introducción

## ¿Qué es esto?

Esta es la hoja de ruta interactiva de **JobTrack API** — un proyecto de portafolio para dominar NestJS de cero a production-ready, módulo por módulo.

No encuentras aquí 10 proyectos de juguete: construyes **una sola API real** y en cada módulo le agregas una capa de complejidad.

### El dominio: JobTrack API

Una plataforma de gestión de búsqueda de empleo. Agregás ofertas laborales (de scraping o carga manual), gestionás postulaciones con estados y recibís recomendaciones según tu perfil profesional.

| Entidad        | Descripción                                                        |
| -------------- | ------------------------------------------------------------------ |
| `User`         | Usuario de la plataforma (el buscador de empleo)                   |
| `Profile`      | Perfil profesional: stack, años de experiencia, CV parseado        |
| `JobOffer`     | Oferta laboral agregada (de scraping o carga manual)               |
| `Application`  | Postulación de un `User` a un `JobOffer`, con estado               |
| `Company`      | Empresa asociada a una oferta                                      |
| `Notification` | Notificación al usuario (nueva oferta relevante, cambio de estado) |

## ¿Qué vas a dominar?

- **Módulo 0** — Fundamentos y setup del proyecto
- **Módulo 1** — Módulos, controladores, providers e inyección de dependencias
- **Módulo 2** — DTOs, validación, pipes y manejo de errores
- **Módulo 3** — Persistencia: PostgreSQL, TypeORM/Prisma, relaciones y migraciones
- **Módulo 4** — Autenticación (JWT) y autorización (Guards, RBAC)
- **Módulo 5** — Interceptors, middleware y observabilidad
- **Módulo 6** — Testing: la pirámide completa
- **Módulo 7** — Scheduling, colas y el corazón del scraping
- **Módulo 8** — WebSockets: notificaciones en tiempo real
- **Módulo 9** — Microservicios (opcional)
- **Módulo 10** — Seguridad avanzada, resiliencia y checklist OWASP
- **Módulo 11** — CI/CD, Docker y despliegue
- **Módulo 12** — Cierre de portafolio

## 🏁 Fin del roadmap

Todo el roadmap está **completo** ✅ — de `npm run dev` a dos procesos en contenedores con CI/CD. Lo que queda es comunicar lo construido: las [war stories](/guide/war-stories) para las preguntas de entrevista y el [walkthrough](/guide/walkthrough) para mostrar el sistema en vivo.

## Requisitos

- Conocimientos básicos de TypeScript
- Node.js >= 18 instalado
- [Sigue el inicio rápido del README](https://github.com/tu-usuario/jobtrack-api) para levantar el proyecto

## Stack

- **Framework:** NestJS 12
- **Validación:** Zod
- **Testing:** Vitest + Supertest
- **Linting:** Oxlint + Prettier
- **Pre-commit:** Husky + lint-staged
- **Health checks:** @nestjs/terminus

Continúa con [Cómo usar este documento](/guide/how-to-use).
