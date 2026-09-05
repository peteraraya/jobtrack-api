import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'JobTrack API',
  description:
    'Hoja de ruta NestJS: de cero a production-ready. Proyecto de portafolio JobTrack API.',
  lang: 'es-ES',
  base: '/jobtrack-api/',
  cleanUrls: true,
  head: [
    [
      'link',
      { rel: 'icon', type: 'image/svg+xml', href: '/jobtrack-api/logo.svg' },
    ],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Inicio', link: '/' },
      { text: 'Guía', link: '/guide/intro' },
      { text: 'Roadmap Original', link: '/roadmap' },
      {
        text: 'Repositorio',
        link: 'https://github.com/tu-usuario/jobtrack-api',
      },
    ],
    sidebar: [
      {
        text: 'Guía',
        items: [
          { text: 'Introducción', link: '/guide/intro' },
          { text: 'Cómo usar este documento', link: '/guide/how-to-use' },
          { text: 'Estructura del proyecto', link: '/guide/structure' },
          {
            text: 'Checklist de seguridad (OWASP)',
            link: '/guide/security-checklist',
          },
          { text: 'War stories', link: '/guide/war-stories' },
          { text: 'Walkthrough', link: '/guide/walkthrough' },
        ],
      },
      {
        text: 'Módulos',
        items: [
          { text: 'Módulo 0 — Fundamentos y setup', link: '/guide/module-00' },
          {
            text: 'Módulo 1 — Módulos, DI e inyección',
            link: '/guide/module-01',
          },
          {
            text: 'Módulo 2 — DTOs, validación y pipes',
            link: '/guide/module-02',
          },
          {
            text: 'Módulo 3 — Persistencia: Postgres',
            link: '/guide/module-03',
          },
          { text: 'Módulo 4 — Auth JWT y RBAC', link: '/guide/module-04' },
          {
            text: 'Módulo 5 — Interceptors y observabilidad',
            link: '/guide/module-05',
          },
          { text: 'Módulo 6 — Testing: la pirámide', link: '/guide/module-06' },
          {
            text: 'Módulo 7 — Scheduling, colas y scraping',
            link: '/guide/module-07',
          },
          { text: 'Módulo 8 — WebSockets', link: '/guide/module-08' },
          { text: 'Módulo 9 — Microservicios', link: '/guide/module-09' },
          {
            text: 'Módulo 10 — Seguridad avanzada y OWASP',
            link: '/guide/module-10',
          },
          { text: 'Módulo 11 — CI/CD y despliegue', link: '/guide/module-11' },
          {
            text: 'Módulo 12 — Cierre de portafolio',
            link: '/guide/module-12',
          },
        ],
      },
      {
        text: 'Referencia',
        items: [
          { text: 'Entidades de dominio', link: '/reference/entities' },
          {
            text: 'Código fuente (módulo 0)',
            link: '/reference/code-module-0',
          },
          {
            text: 'Código fuente (módulo 1)',
            link: '/reference/code-module-1',
          },
          {
            text: 'Código fuente (módulo 2)',
            link: '/reference/code-module-2',
          },
          {
            text: 'Código fuente (módulo 3)',
            link: '/reference/code-module-3',
          },
          {
            text: 'Código fuente (módulo 4)',
            link: '/reference/code-module-4',
          },
          {
            text: 'Código fuente (módulo 5)',
            link: '/reference/code-module-5',
          },
          {
            text: 'Código fuente (módulo 6)',
            link: '/reference/code-module-6',
          },
          {
            text: 'Código fuente (módulo 7)',
            link: '/reference/code-module-7',
          },
          {
            text: 'Código fuente (módulo 8)',
            link: '/reference/code-module-8',
          },
          {
            text: 'Código fuente (módulo 9)',
            link: '/reference/code-module-9',
          },
          {
            text: 'Código fuente (módulo 10)',
            link: '/reference/code-module-10',
          },
          {
            text: 'Código fuente (módulo 11)',
            link: '/reference/code-module-11',
          },
        ],
      },
    ],
    outline: { level: [2, 3], label: 'En esta página' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
          modal: {
            noResultsText: 'Sin resultados',
            resetButtonTitle: 'Limpiar búsqueda',
            footer: {
              selectText: 'para seleccionar',
              navigateText: 'para navegar',
            },
          },
        },
      },
    },
    docFooter: {
      prev: 'Anterior',
      next: 'Siguiente',
    },
    returnToTopLabel: 'Volver arriba',
    lastUpdated: {
      text: 'Última actualización',
      formatOptions: { dateStyle: 'short' },
    },
  },
  markdown: {
    lineNumbers: true,
  },
});
