#!/usr/bin/env node
// Builds the pinned upstream llama.cpp for the browser (ADR-0066): the WebGPU
// backend through Dawn's emdawnwebgpu, wasm64, JSPI, plus our shim
// (apps/game/llama/shim.cpp). The output goes to public/vendor/llama/
// (git-ignored; it is a build product, not a vendored copy).
//
//   pnpm --filter @swarm-press/game llama:runtime
//
// Needs cmake, ninja and the Emscripten SDK (EMSDK, else ~/emsdk). The
// llama.cpp checkout and the emdawnwebgpu package live in LLAMA_CACHE
// (default ~/Library/Caches/swarmpress-llama), outside the repository.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const lock = JSON.parse(readFileSync(join(root, 'src/llm/runtime/llama/runtime.lock.json'), 'utf8'))
const cache = process.env.LLAMA_CACHE ?? join(homedir(), 'Library/Caches/swarmpress-llama')
const emsdk = process.env.EMSDK ?? join(homedir(), 'emsdk')
const llamaDir = join(cache, 'llama.cpp')
const dawnDir = join(cache, `emdawnwebgpu-${lock.emdawnwebgpu.tag}`)
const buildDir = join(cache, 'build-browser')
const outDir = join(root, 'public/vendor/llama')

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const out = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim()

mkdirSync(cache, { recursive: true })

// The pinned commit.
if (!existsSync(join(llamaDir, '.git'))) run('git', ['clone', '--no-checkout', lock.llamaCpp.repo, llamaDir])
try {
  out('git', ['-C', llamaDir, 'cat-file', '-e', lock.llamaCpp.commit])
} catch {
  run('git', ['-C', llamaDir, 'fetch', 'origin', lock.llamaCpp.commit])
}
if (out('git', ['-C', llamaDir, 'rev-parse', 'HEAD']) !== lock.llamaCpp.commit) {
  run('git', ['-C', llamaDir, 'checkout', '--detach', lock.llamaCpp.commit])
}

// Dawn's Emscripten bindings, in step with upstream's wasm CI.
if (!existsSync(join(dawnDir, 'emdawnwebgpu_pkg'))) {
  mkdirSync(dawnDir, { recursive: true })
  run('curl', ['-fL', '-o', join(dawnDir, 'pkg.zip'), lock.emdawnwebgpu.url])
  run('unzip', ['-q', '-o', join(dawnDir, 'pkg.zip'), '-d', dawnDir])
}

// Configure and build inside the Emscripten environment.
const sh = (script) => run('bash', ['-c', `source "${emsdk}/emsdk_env.sh" >/dev/null 2>&1 && ${script}`], { cwd: cache })
sh(
  `emcmake cmake -S "${join(root, 'llama')}" -B "${buildDir}" -G Ninja -DCMAKE_BUILD_TYPE=Release ` +
    `-DLLAMA_CPP_DIR="${llamaDir}" -DEMDAWNWEBGPU_DIR="${join(dawnDir, 'emdawnwebgpu_pkg')}"`,
)
sh(`cmake --build "${buildDir}" --target llama-shim -j ${out('sysctl', ['-n', 'hw.ncpu'])}`)

mkdirSync(outDir, { recursive: true })
for (const f of ['llama.mjs', 'llama.wasm']) copyFileSync(join(buildDir, f), join(outDir, f))
writeFileSync(
  join(outDir, 'build-info.json'),
  JSON.stringify({ llamaCpp: lock.llamaCpp.commit, emdawnwebgpu: lock.emdawnwebgpu.tag, builtAt: new Date().toISOString() }, null, 2) + '\n',
)
console.log(`ok ${outDir}`)
