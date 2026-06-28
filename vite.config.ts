import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// White-Label Stufe 0: Branding aus Build-ENV (VITE_BRAND_*), sonst NutriScan-Default.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const name = env.VITE_BRAND_NAME || 'NutriScan'
  const short = env.VITE_BRAND_SHORT || 'NutriScan'
  const description = env.VITE_BRAND_DESCRIPTION || 'Kalorien, Makros & Mineralstoffe tracken – mit KI-Unterstützung.'
  const themeColor = env.VITE_BRAND_THEME_COLOR || '#16a34a'

  return {
    plugins: [
      react(),
      {
        // Title + theme-color im index.html durch die Markenwerte ersetzen.
        name: 'brand-html',
        transformIndexHtml(html: string) {
          return html
            .replace(/<title>[\s\S]*?<\/title>/, `<title>${name}</title>`)
            .replace(/(<meta name="theme-color" content=")[^"]*(")/, `$1${themeColor}$2`)
        },
      },
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name,
          short_name: short,
          description,
          theme_color: themeColor,
          background_color: '#0b0f0c',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  }
})
