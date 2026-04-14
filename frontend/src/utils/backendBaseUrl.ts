export function resolveBackendBaseUrl(configuredUrl?: string): string {
  const configured = String(configuredUrl || '').trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const hostname = window.location.hostname.toLowerCase();
  const isRefernexFrontend = hostname.endsWith('refernex.com') && !hostname.startsWith('api.');
  if (isRefernexFrontend) {
    return `${window.location.protocol}//api.refernex.com`;
  }

  return window.location.origin.replace(/\/+$/, '');
}