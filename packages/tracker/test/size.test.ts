// @vitest-environment node
// esbuild refuses to run inside jsdom, so the size budget runs under node.
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped build helper
import { BUDGET_GZIP_BYTES, bundle } from '../scripts/build.mjs';

describe('bundle', () => {
  it(`is at most ${BUDGET_GZIP_BYTES} bytes gzipped (ADR-0032: 1.5 KB)`, async () => {
    const code: string = await bundle();
    const gz = gzipSync(code, { level: 9 }).length;
    expect(gz).toBeLessThanOrEqual(BUDGET_GZIP_BYTES);
    expect(code).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/);
  });
});
