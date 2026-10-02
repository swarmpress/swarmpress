// Build the beacon to dist/tracker.min.js.
//   --sync   also copy it to crates/server/assets/tracker.min.js (embedded by the server)
//   --check  fail if the server's embedded copy differs from a fresh build (CI drift check)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

export const BUDGET_GZIP_BYTES = 1536;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist/tracker.min.js');
const embedded = resolve(root, '../../crates/server/assets/tracker.min.js');

export async function bundle() {
  const out = await build({
    entryPoints: [resolve(root, 'src/index.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2018',
    legalComments: 'none',
    write: false,
  });
  return out.outputFiles[0].text;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await bundle();
  const gz = gzipSync(code, { level: 9 }).length;
  mkdirSync(dirname(dist), { recursive: true });
  writeFileSync(dist, code);
  console.log(`dist/tracker.min.js: ${code.length} B, ${gz} B gzip (budget ${BUDGET_GZIP_BYTES})`);
  if (gz > BUDGET_GZIP_BYTES) {
    console.error('tracker is over its gzip budget');
    process.exit(1);
  }
  if (process.argv.includes('--sync')) {
    writeFileSync(embedded, code);
    console.log('synced crates/server/assets/tracker.min.js');
  }
  if (process.argv.includes('--check')) {
    const current = readFileSync(embedded, 'utf8');
    if (current !== code) {
      console.error('crates/server/assets/tracker.min.js is stale: run `pnpm --filter tracker sync`');
      process.exit(1);
    }
    console.log('embedded tracker is up to date');
  }
}
