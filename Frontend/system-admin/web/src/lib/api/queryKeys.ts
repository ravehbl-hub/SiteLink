/** React Query key factory (Architecture §3.3 — shared key philosophy). */
export const qk = {
  me: ['me'] as const,
  health: ['health'] as const,
  boStatus: ['backoffice', 'status'] as const,
  boUsers: ['backoffice', 'users'] as const,
  boProfitLoss: (params: unknown) => ['backoffice', 'profit-loss', params] as const,
  users: (params: unknown) => ['users', params] as const,
};
