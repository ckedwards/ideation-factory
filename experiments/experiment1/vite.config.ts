import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The MVP idea reads the real docs from the repository's mvp/ folder, which is
// outside this project, so the dev server may serve files from the repo root.
const repoRoot = new URL('../..', import.meta.url).pathname

export default defineConfig({ plugins: [react()], server: { port: 5199, fs: { allow: [repoRoot] } } })
