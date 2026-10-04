#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { run } from './run.js'
import { createNodeRuntime } from './runtime.js'

function readVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// Piping into `head` and friends closes stdout early; that is not an error.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error
})

process.exitCode = await run(process.argv.slice(2), createNodeRuntime(readVersion()))
