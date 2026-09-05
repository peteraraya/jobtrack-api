# Módulo 12 — Cierre de portafolio

> **Estado:** ✅ Completo · **Entrega:** portafolio listo para entrevista

## Qué entregó este módulo

No agregó código nuevo — agregó **evidencia de cómo pensás**:

1. **README final** con el diagrama de arquitectura (módulos + flujo de datos entre los dos procesos), la tabla de **decisiones técnicas y trade-offs** (con la decisión de microservicios del Módulo 9 a la cabeza), setup en un comando y el link al deploy en vivo.
2. **5 war stories** reales del desarrollo en [docs/guide/war-stories.md](/guide/war-stories): el N+1 cazado contando queries, el cambio de rumbo de cron a colas + circuit breaker, la rotación de refresh tokens con hash, el bug del volumen que casi rompe el primer `docker compose up`, y la decisión más opinable (el micromonolito). Cada una con "contexto → qué pasó → cómo lo resolví → qué aprendí → dónde está en el repo".
3. **Walkthrough de 5–7 min** en [docs/guide/walkthrough.md](/guide/walkthrough) — el guion minuto a minuto de qué mostrar y qué decir sobre el sistema vivo, y las preguntas que seguro hacen.

## Por qué se cuenta en entrevista

- El N+1 (story #1) demuestra que medís antes de optimizar; el test-count lo cierra.
- Cron → colas (story #2) demuestra que el diseño evoluciona con el problema, no con la moda.
- Las historias son **cortitas y verificables**: cada una apunta a una línea del repo.

→ [War stories](/guide/war-stories) · [Walkthrough](/guide/walkthrough) · 🏁 [Fin del roadmap](/guide/intro)
