// Splits large drawio bundles into ~1MB parts so they can cross the DBX
// bridge (Tauri invoke) safely — WKWebView IPC chokes on multi-megabyte
// base64 payloads, which left the editor booting forever.
//
// Run after refreshing public/drawio:  node scripts/split-bundles.mjs
// Produces public/drawio/js/<base>.part-<index> files plus
// src/drawio-bundles.json (vfs-path-keyed manifest the shell imports).

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const jsDir = join(root, "public/drawio/js");
const PART_BYTES = 1024 * 1024;
const THRESHOLD = 1024 * 1024;

const manifestPath = join(root, "src/drawio-bundles.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

function clearParts(base) {
  for (const entry of readdirSync(jsDir)) {
    if (entry.startsWith(`${base}.part-`)) unlinkSync(join(jsDir, entry));
  }
}

// key is the vfs path ("js/app.min.js"); part files live flat in js/.
function split(key) {
  const base = key.split("/").pop();
  const file = join(jsDir, base);
  if (!existsSync(file)) {
    // Idempotent rerun: rebuild the manifest from existing parts.
    const parts = readdirSync(jsDir).filter((entry) => entry.startsWith(`${base}.part-`));
    if (parts.length > 0) manifest[key] = parts.length;
    return;
  }
  const bytes = readFileSync(file);
  if (bytes.length <= THRESHOLD) {
    manifest[key] = null; // served whole
    return;
  }
  clearParts(base);
  const count = Math.ceil(bytes.length / PART_BYTES);
  for (let index = 0; index < count; index += 1) {
    writeFileSync(
      join(jsDir, `${base}.part-${String(index).padStart(4, "0")}`),
      bytes.subarray(index * PART_BYTES, (index + 1) * PART_BYTES),
    );
  }
  unlinkSync(file);
  manifest[key] = count;
  console.log(`${key}: ${bytes.length} bytes -> ${count} parts`);
}

for (const candidate of ["js/app.min.js", "js/stencils.min.js", "js/extensions.min.js", "js/shapes-14-6-5.min.js"]) {
  split(candidate);
}

writeFileSync(
  join(root, "src/drawio-bundles.json"),
  JSON.stringify(
    Object.fromEntries(Object.entries(manifest).filter(([, count]) => count !== null)),
    null,
    2,
  ) + "\n",
);
console.log("manifest -> src/drawio-bundles.json");
