// src/lib/assets.ts

/**
 * Base path from astro.config.mjs (e.g. "/la_nube_roja").
 * Astro's BASE_URL already includes leading and trailing slash,
 * so we strip the trailing one to concatenate cleanly.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Builds an absolute URL path prefixed with the project base.
 *
 * assetPath('/catalog/pizza.webp')
 *   -> '/la_nube_roja/catalog/pizza.webp'  (en build con base configurado)
 *   -> '/catalog/pizza.webp'               (en dev sin base)
 */
export function assetPath(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${clean}`;
}