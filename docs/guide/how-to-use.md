# Cómo usar este documento

## Duración estimada

**10–14 semanas** a ritmo de 10–12 hrs/semana (ajustable). Cada módulo indica una duración sugerida.

## Criterio de completado

> Avanza al siguiente módulo **solo cuando puedas explicar el módulo anterior en voz alta sin mirar el código** — ese es el verdadero criterio de "completado", no la fecha.

## Convención de ramas Git

Cada módulo vive en su propia rama (`module-01-foundations`, `module-02-validation`, …) que mergeás a `main` al cerrar el módulo.

Esto te da:

- Un historial de PRs revisable.
- Evidencia de proceso de trabajo en entrevistas.

```bash
# flujo por módulo
git checkout -b module-01-foundations
# ... trabajar el módulo ...
git commit -am "feat(module-01): CRUD job-offers en memoria"
git checkout main && git merge module-01-foundations
```

## Método de estudio activo

1. 📖 **Leer** la página del módulo en esta guía.
2. 🎯 **Intentar** los ejercicios prácticos sin mirar la solución.
3. 🛠️ **Comparar** con el código real del repositorio.
4. 🗣️ **Verbalizar** los conceptos clave en voz alta.
5. ✅ **Cerrar el módulo** cuando puedas explicarlo sin mirar código.

## Siguiente paso

Revisá la [Estructura del proyecto](/guide/structure) y luego empezá con el [Módulo 0](/guide/module-00).
