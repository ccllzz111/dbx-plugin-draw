// Pin and copy browser components so formulas work with connect-src 'none'.
import { cpSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = join(root, 'public/drawio/math4/es5');
const math = join(root, 'node_modules/mathjax');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const name of ['startup.js', 'core.js', 'input', 'output', 'ui', 'a11y', 'sre', 'LICENSE']) {
  cpSync(join(math, name), join(target, name), { recursive: true });
}
const fontTarget = join(target, 'fonts/mathjax-tex-font');
mkdirSync(fontTarget, { recursive: true });
for (const name of ['svg.js', 'chtml.js', 'chtml']) {
  cpSync(join(root, 'node_modules/@mathjax/mathjax-tex-font', name), join(fontTarget, name), { recursive: true });
}
copyFileSync(join(root, 'node_modules/@mathjax/mathjax-tex-font/package.json'), join(fontTarget, 'package.json'));
// The SVG font is larger than the WKWebView bridge's practical IPC limit.
const font = readFileSync(join(fontTarget, 'svg.js'));
const partBytes = 1024 * 1024;
for (let offset = 0, part = 0; offset < font.length; offset += partBytes, part++) {
  writeFileSync(join(fontTarget, `svg.js.part-${String(part).padStart(4, '0')}`), font.subarray(offset, offset + partBytes));
}
unlinkSync(join(fontTarget, 'svg.js'));
const manifestPath = join(root, 'src/drawio-bundles.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest['math4/es5/fonts/mathjax-tex-font/svg.js'] = Math.ceil(font.length / partBytes);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
