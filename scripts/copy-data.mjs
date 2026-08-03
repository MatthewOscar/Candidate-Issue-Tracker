// Copies the canonical data/*.json files into site/public/data/ so the built
// site ships them as static assets. Runs automatically before dev and build.
import { cp, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'data');
const dest = path.join(root, 'site', 'public', 'data');

await mkdir(dest, { recursive: true });
const files = (await readdir(src)).filter((f) => f.endsWith('.json'));
for (const f of files) {
  await cp(path.join(src, f), path.join(dest, f));
}
console.log(`copy-data: copied ${files.length} file(s) to site/public/data/`);
