# Módulo 8 — WebSockets: notificaciones en tiempo real

> **Estado:** ✅ Completo · **Duración estimada:** 5–6 días
> **Rama de git sugerida:** `module-08-websockets`

## Conceptos clave

- **Gateway ≠ controlador**: `@WebSocketGateway` transforma una clase injectable en el punto de entrada del canal tiempo real — el equivalente a un controller para eventos, no para requests. Corre como provider dentro de Nest y puede inyectar servicios.
- **El dominio NO conoce el transporte**: `NotificationsService` persiste una notificación y emite un **evento de dominio en proceso** (`@nestjs/event-emitter` → `EventEmitter2`). El gateway es el único punto que traduce "se creó una notificación" en un push `server.to(room).emit(...)`. Si mañana cambiamos Socket.IO por Server-Sent Events o NATS, el dominio no se toca.
- **El handshake también es un ataque**: un WebSocket autentica igual que HTTP. Rechazar en `handleConnection` con `client.disconnect(true)` es una **carrera** con el ack del handshake (el cliente llega a ver `connect`, luego `disconnect` — nada determinista). La forma correcta es un **middleware de Socket.IO** (`server.use`) registrado en `afterInit`: el socket inválido jamás entra al namespace y el cliente recibe `connect_error` de forma determinista.
- **Rooms, no broadcast**: cada socket autenticado vive en su room `user:<id>`. Los push se dirigen `server.to('user:<id>')` — un usuario jamás ve las notificaciones de otro, y nadie grita al broadcast global.
- **Nunca confíes en el id que manda el cliente**: el `userId` sale del **JWT verificado en el handshake**, igual que en REST sale del `@CurrentUser()`. El cliente solo puede pedir _su_ canal; lo que es suyo lo decide el server.

## Lo que se implementó

### 1. El bus en proceso: `notifications.events.ts`

Un nombre de evento compartido cruza los dos mundos: el **bus** (`EventEmitter2`, donde emite el service) y el **canal** (Socket.IO, donde se traduce en push). El payload es la notificación persistida sin transporte:

```ts
export const NOTIFICATION_CREATED_EVENT = 'notification.created';

export interface NotificationCreatedEvent {
  userId: string;
  notification: { id: string; type: NotificationType; payload: ...; readAt: Date | null; createdAt: Date };
}
```

`NotificationsService.notifyNewOfferForStack` (flujo del Módulo 7) ahora, además de persistir, emite el evento por cada notificación creada. Cambio mínimo y no invasivo: el service gana una dependencia (`EventEmitter2`), nada de sockets adentro.

### 2. WsAuth (handshake): `ws-auth.service.ts`

El handshake valida **exactamente el mismo contrato que HTTP**, por eso reutiliza `JwtService` (misma `JWT_SECRET`) y `UsersService`:

1. Extrae el token de `handshake.auth.token` (recomendado por `socket.io-client`) o del header `Authorization: Bearer …`.
2. `jwtService.verifyAsync` — token inválido/vencido → `UnauthorizedException`.
3. **Re-consulta del usuario** por `sub`: un usuario borrado o con rol cambiado pierde el canal al instante (mismo principio que `JwtStrategy` en HTTP).

Devuelve un `AuthedUser` (`{ id, email, role }`), el mismo shape que usa el resto de la app.

### 3. El gateway: `notifications.gateway.ts`

Namespace `/notifications`, CORS desde `CORS_ORIGINS` (vacío → `'*'`, como en HTTP):

- **`afterInit`** — registra el middleware de autenticación con `server.use(...)`. El handler **retorna la cadena de promesas** (Socket.IO la ignora, vuelve a los tests deterministas): si `authenticateSocket` resuelve coloca `socket.data.user` y llama `next()`; si rechaza, `next(new Error(...))` → el cliente ve `connect_error`.
- **`handleConnection`** — el middleware ya autenticó; acá solo une al room de su usuario y loguea la conexión (sin requestId: no hay request; el logger del gateway es suficiente).
- **`@OnEvent(NOTIFICATION_CREATED_EVENT)`** — re-traduce el evento de dominio en un push dirigido: `server.to('user:<id>').emit('notification.created', { data: { ... } })`. El `{ data }` mantiene el contrato de respuesta del Módulo 5.

Lección de implementación: **autenticar como middleware, no en `handleConnection`**. La primera versión rechazaba ahí con `client.disconnect(true)`; en e2e era una carrera intermitente (el cliente veía `connect` y después `disconnect`, o solo `disconnect`). Con middleware el rechazo es un `connect_error` estable y testeable.

### 4. REST complementario: `notifications.controller.ts`

El canal empuja lo **nuevo**; el historial y el estado son REST (no tiene sentido re-pushear lo que ya está en la BD):

| Método  | Ruta                          | Descripción                                                                |
| ------- | ----------------------------- | -------------------------------------------------------------------------- |
| `GET`   | `/notifications`              | Historial del dueño del token                                              |
| `GET`   | `/notifications/unread-count` | Pendientes de leer                                                         |
| `PATCH` | `/notifications/:id/read`     | Marcar leída (solo dueña; ajena → **404**, no 403: no se revela si existe) |

El ownership sale del `userId` del token (`@CurrentUser()`), nunca de un id del body — mismo patrón que en `applications`.

### 5. Wiring del módulo

`NotificationsModule` importa `UsersModule` (para validar el usuario del handshake), `JwtModule.registerAsync` (misma secret/expiración que auth) y `EventEmitterModule.forRoot()` — **el bus es global** (importarlo una sola vez; si el repo ya lo tiene en otro módulo, no duplicar), los `@OnEvent` se registran en `onApplicationBootstrap` y los tests unitarios deben `await module.init()` tras `compile()`.

El adaptador `@nestjs/platform-socket.io` (ioAdapter) se activa **solo con estar instalado** — no hace falta `useWebSocketAdapter()`.

### 6. E2E del realtime (3 tests nuevos en `test/app.e2e-spec.ts`)

El app del e2e vive in-process (supertest), así que el bloque de WS hace `app.listen(0)` y usa `app.getHttpServer().address().port`, con cliente `socket.io-client` (`forceNew`, `transports:['websocket']`, `auth:{token}`) y timeout de test de 60s:

1. **Rechazos**: sin token y con token basura → `connect_error` (el helper espera `connect` **o** rechazo; el listener de `disconnect` queda activo hasta resolverse, porque el server puede rechazar justo después del `connect` del cliente).
2. **Push por room**: Alice y Bob con socket conectado; se dispara el flujo real (insert de perfil + `notifyNewOfferForStack`) y se espera por polling (`waitForCondition`) hasta que Alice reciba `notification.created` con `type: 'new_offer'`; Bob recibe **cero** eventos.
3. **REST**: sin token → 401; listado solo del dueño; `unread-count`; marcar leída ajena → 404; propia → `readAt` set; el contador baja.

## Mejores prácticas aplicadas

- ✅ Acoplamiento en una sola dirección: dominio → bus (`EventEmitter2`) → gateway → Socket.IO. El service no sabe que existe un canal.
- ✅ Autenticación del handshake como middleware determinista (mismo JWT + re-validación de usuario que HTTP).
- ✅ Push dirigido por **rooms** (`user:<id>`); `userId` siempre del token, nunca del cliente.
- ✅ REST para comandos/historial, WS solo para lo que cambia — cada transporte hace lo que le toca.
- ✅ CORS configurable por env; `{ data }` en el payload WS mantiene el contrato de respuesta del Módulo 5.
- ✅ Testing con puerto efímero (`app.listen(0)`) y espera por polling, no `sleep` ciego.

## Verificación del entregable

```bash
npm run build             # compila
npm run lint              # 0 warnings, 0 errors
npm test                  # 64 unit → all passed
npm run test:integration  # 5 integration → all passed (requiere Postgres en 5433)
npm run test:e2e          # 48 e2e → all passed (requiere Postgres 5433 + Redis 6379)
```

Los e2e del realtime validan contra Postgres + Redis reales y colas purgadas por test. En CI, el workflow ya corre con _service containers_ para ambos.

Anterior: [Módulo 7](/guide/module-07) · Siguiente: [Módulo 9](/guide/module-09)
