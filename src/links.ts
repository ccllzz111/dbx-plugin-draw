export const SHORTCUTS_URL = 'https://app.diagrams.net/shortcuts.svg';

/** Relative help links belong to draw.io, never the srcdoc/plugin origin. */
export function externalLink(href: unknown): string | null {
  if (typeof href !== 'string' || !href.trim() || href.startsWith('#')) return null;
  try {
    const url = new URL(href, 'https://app.diagrams.net/');
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
