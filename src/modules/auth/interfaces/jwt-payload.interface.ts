/** Estructura interna del JWT (access y refresh comparten claims). */
export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'user';
  /** Identificador único por firma: evita tokens idénticos en el mismo segundo. */
  jti: string;
}
