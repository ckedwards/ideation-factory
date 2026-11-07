// The web app's build. In development Vite runs behind the server (bun run
// dev starts both): the server passes it the pages' requests, so the browser
// only ever talks to the server, as in production. Only hot reloading
// connects to Vite directly, on the worktree's own port.
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const port = Number(process.env['IDEAF_WEB_DEV_PORT'] ?? 8081)

export default defineConfig({
  plugins: [
    // routes are the files in src/routes; each route's code loads when it's first needed
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
  ],
  server: { port, strictPort: true, hmr: { clientPort: port } },
  build: { sourcemap: true },
})
