import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const base = join(root, 'public/drawio');
const manifest = JSON.parse(readFileSync(join(root, 'vendor/drawio.json'), 'utf8'));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (path === join(base, 'math4')) return [];
    return entry.isDirectory() ? files(path) : [relative(base, path).replaceAll('\\', '/')];
  });
}
const actual = files(base).sort();
if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error('Vendored draw.io file list changed');
for (const [path, hash] of Object.entries(manifest.files)) {
  const found = createHash('sha256').update(readFileSync(join(base, path))).digest('hex');
  if (hash !== found) throw new Error(`Vendored draw.io checksum mismatch: ${path}`);
}
console.log(`Verified ${actual.length} vendored draw.io assets (${manifest.version}).`);
