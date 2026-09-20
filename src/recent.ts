export interface RecentFile {
  id: string;
  name: string;
  xml: string;
  openedAt: number;
}

export const RECENT_KEY = "recent-files-v1";
const MAX_FILES = 10;
// Leave headroom under the DBX bridge's 2 MiB JSON request limit.
const MAX_BYTES = 1500 * 1024;

export function parseRecentFiles(value: unknown): RecentFile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((entry): entry is RecentFile => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id ||
      typeof entry.name !== 'string' || typeof entry.xml !== 'string' ||
      !/^\s*(?:<\?xml[^>]*>\s*)?<(?:mxfile|mxGraphModel)[\s/>]/.test(entry.xml) ||
      typeof entry.openedAt !== 'number' || !Number.isFinite(entry.openedAt) || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_FILES);
}

/** Most recent first; retain distinct documents even when names match. */
export function rememberFile(files: RecentFile[], file: RecentFile): RecentFile[] {
  if (new TextEncoder().encode(JSON.stringify([file])).length > MAX_BYTES) throw new Error('File too large for recent history');
  const next = [file, ...files.filter(entry => entry.id !== file.id)].slice(0, MAX_FILES);
  while (next.length && new TextEncoder().encode(JSON.stringify(next)).length > MAX_BYTES) next.pop();
  return next;
}
