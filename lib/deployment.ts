export function backendOrigin(value: string | undefined, vercel = false): string | null {
  if (!value) {
    if (vercel)
      throw new Error(
        'Set ORBIT_BACKEND_URL to your persistent backend before deploying ORBIT to Vercel.',
      );
    return null;
  }
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !vercel)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('ORBIT_BACKEND_URL must be an HTTPS origin without a path or credentials.');
  return url.origin;
}

// A frontend proxy changes Host, but preserves the browser's original Origin.
// A configured public origin must match exactly; never trust forwarded headers here.
export function allowedMutationOrigin(
  origin: string | null,
  host: string | null,
  publicOrigin?: string,
) {
  if (!origin) return true;
  if (!URL.canParse(origin)) return false;
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
  return publicOrigin ? origin === publicOrigin : url.host === host;
}
