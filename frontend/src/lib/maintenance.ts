const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env || {};

function parseBooleanFlag(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export const AUTH_MAINTENANCE_ENABLED = parseBooleanFlag(env.VITE_AUTH_MAINTENANCE_ENABLED, true);
export const AUTH_MAINTENANCE_MESSAGE =
  (typeof env.VITE_AUTH_MAINTENANCE_MESSAGE === 'string' && env.VITE_AUTH_MAINTENANCE_MESSAGE.trim())
    ? env.VITE_AUTH_MAINTENANCE_MESSAGE.trim()
    : 'System in under Maintainance for 72 hours, Try Again After 72 hours';
