#!/usr/bin/env node
// `kit` — @swarm-press/site-kit CLI. Sources are TypeScript; tsx loads them.
import { register } from 'tsx/esm/api'

register()
const { main } = await import('../src/cli.ts')
const code = await main(process.argv.slice(2))
process.exitCode = code
