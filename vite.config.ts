/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serves the site from /gear-designer/
  base: command === 'build' ? '/gear-designer/' : '/',
  // workshop-kit ships TypeScript + CSS modules; compile it with the app instead of pre-bundling
  optimizeDeps: { exclude: ['@tomkail/workshop-kit'] },
  resolve: { dedupe: ['react', 'react-dom', 'zustand', 'lucide-react'] },
  // Allows `npm link @tomkail/workshop-kit` against a sibling checkout
  server: { fs: { allow: ['.', '../workshop-kit'] } },
  test: { server: { deps: { inline: ['@tomkail/workshop-kit'] } } },
}))
