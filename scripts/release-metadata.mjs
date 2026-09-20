// Generate a DBX Store PR payload from the exact packaged bytes, never from
// stale hand-written hashes. Runs on the Linux release runner (zip/unzip).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repository = process.env.RELEASE_REPOSITORY || 'ccllzz111/dbx-plugin-draw';
const tag = process.env.RELEASE_TAG || `v${manifest.version}`;
if (repository !== 'ccllzz111/dbx-plugin-draw') throw new Error('Unexpected release repository');
if (tag !== `v${manifest.version}` || pkg.version !== manifest.version) throw new Error('Release tag/package/manifest version mismatch');
const filename = `${manifest.id}-${manifest.version}-universal.dbxp`;
const packagePath = join(dist, filename);
const bytes = readFileSync(packagePath);
const entries = execFileSync('unzip', ['-Z1', packagePath], { encoding: 'utf8' }).trim().split(/\r?\n/);
if (entries.includes('signature.json')) throw new Error('Store candidates must be unsigned');
for (const required of ['ui/index.html', 'ui/drawio/index.html', 'ui/drawio/LICENSE', 'ui/drawio/math4/es5/startup.js', 'ui/THIRD_PARTY_NOTICES.md']) {
  if (!entries.includes(required)) throw new Error(`Package missing ${required}`);
}
const packed = JSON.parse(execFileSync('unzip', ['-p', packagePath, 'manifest.json'], { encoding: 'utf8' }));
for (const key of ['id', 'publisher', 'version']) if (packed[key] !== manifest[key]) throw new Error(`Packaged ${key} mismatch`);
const artifact = JSON.parse(readFileSync(join(dist, filename.replace('.dbxp', '.artifact.json')), 'utf8'));
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (artifact.sha256 !== sha256 || artifact.size !== bytes.length || artifact.target !== 'universal') throw new Error('Artifact metadata does not match package bytes');
const homepage = `https://github.com/${repository}`;
const target = { target: 'universal', url: `${homepage}/releases/download/${tag}/${filename}`, sha256, size: bytes.length };
const identity = { id: manifest.id, name: manifest.name, description: manifest.description, publisher: manifest.publisher, version: manifest.version, permissions: manifest.permissions || [] };
const json = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
json(join(dist, 'release-candidates.json'), { plugin: identity, artifacts: [target] });
const submission = join(dist, 'store-submission');
mkdirSync(join(submission, 'candidates'), { recursive: true });
mkdirSync(join(submission, 'publishers'), { recursive: true });
json(join(submission, 'candidates', `${manifest.id}.json`), {
  schemaVersion: 1, ...identity, source: `${homepage}/tree/${tag}`, homepage,
  license: 'Apache-2.0', icon: `https://raw.githubusercontent.com/${repository}/${tag}/assets/plugin.svg`,
  tags: ['diagrams', 'drawio'], releaseNotes: 'Offline diagrams, mathematical typesetting, PNG/SVG exports and session recent files. See README for sandbox limitations.',
  targets: [target],
});
json(join(submission, 'publishers', `${manifest.publisher}.json`), { id: manifest.publisher, name: 'ccllzz111', status: 'unverified' });
const archive = join(dist, 'dbx-store-submission.zip');
rmSync(archive, { force: true });
execFileSync('zip', ['-q', '-r', archive, ...readdirSync(submission).sort()], { cwd: submission });
console.log(`Verified ${filename}; generated release-candidates.json and DBX Store PR files.`);
