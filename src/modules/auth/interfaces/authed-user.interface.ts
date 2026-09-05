/** Usuario autenticado que JwtAuthGuard adjunta a req.user. */
export interface AuthedUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}
