import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://ayagmar.github.io',
  base: '/modmgr',
  integrations: [sitemap()],
  // Small inline styles stay inline; the page ships no client framework.
  build: { inlineStylesheets: 'always' },
  // The keymap and the demo frames come from the plugin and the tests (PLAN §8, R23).
  vite: { server: { fs: { allow: ['..'] } } },
})
