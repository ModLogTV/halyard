import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
  // PORT comes from the root .env (loaded by the package scripts). strictPort fails instead of
  // falling back to another port, which would no longer match BETTER_AUTH_URL.
  server: { port: Number(process.env.PORT) || 3000, strictPort: true },
})
