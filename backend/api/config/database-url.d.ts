export const POSTGRES_FALLBACK_KEYS: readonly [
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD"
];

export function resolveDatabaseUrl(
  environment: Record<string, unknown>,
  fallback?: string
): string;
