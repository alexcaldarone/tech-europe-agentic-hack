import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { parse } from 'yaml'

const repoRoot = path.resolve(import.meta.dirname, '..')
const config = parse(fs.readFileSync(path.join(repoRoot, 'configs/default.yaml'), 'utf-8'))
const ideaUpdatesPath = path.join(repoRoot, config.pubsub.dir, config.pubsub.idea_updates)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    // The browser cannot read pubsub files, so the dev server serves the idea-updates topic as is.
    name: 'pubsub-idea-updates',
    configureServer(server) {
      server.middlewares.use('/api/pubsub/idea-updates.jsonl', (_request, response) => {
        response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(fs.existsSync(ideaUpdatesPath) ? fs.readFileSync(ideaUpdatesPath) : '')
      })
    },
  }],
  define: {
    __IDEA_POLL_INTERVAL_MS__: JSON.stringify(config.frontend.poll_interval_ms),
  },
  server: {
    proxy: {
      '/api/transcriber': {
        target: process.env.TRANSCRIBER_TARGET || 'http://127.0.0.1:8000',
        ws: true,
        rewrite: path => path.replace(/^\/api\/transcriber/, ''),
      },
      '/api/enrichment': {
        target: process.env.ENRICHMENT_TARGET || 'http://127.0.0.1:3000',
        rewrite: path => path.replace(/^\/api\/enrichment/, '/api'),
      },
    },
  },
})
