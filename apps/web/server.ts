/**
 * Production server for Halyard on Bun.
 *
 * Serves the static client build from dist/client and forwards everything else
 * to the TanStack Start server entry built into dist/server/server.js.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.env.PORT ?? 3000)
const clientDir = join(import.meta.dir, 'dist', 'client')
const serverEntry = join(import.meta.dir, 'dist', 'server', 'server.js')

if (!existsSync(serverEntry)) {
  console.error(`Server build not found at ${serverEntry}. Run "bun run build" first.`)
  process.exit(1)
}

const app = (await import(serverEntry)) as { default: { fetch: (req: Request) => Promise<Response> | Response } }

// Warm up migrations and workers before accepting traffic.
await app.default.fetch(new Request(`http://localhost:${port}/healthz`))

const immutableCache = 'public, max-age=31536000, immutable'

Bun.serve({
  port,
  idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === 'GET' || request.method === 'HEAD') {
      const path = decodeURIComponent(url.pathname)
      if (path !== '/' && !path.includes('..')) {
        const file = Bun.file(join(clientDir, path))
        if (await file.exists()) {
          const headers: Record<string, string> = { 'Content-Type': file.type }
          if (path.startsWith('/assets/')) headers['Cache-Control'] = immutableCache
          return new Response(file, { headers })
        }
      }
    }
    return app.default.fetch(request)
  },
})

console.log(`Halyard listening on http://0.0.0.0:${port}`)
