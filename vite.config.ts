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
  // Default-Theme „vital": primary #10B981 (themes.css / Theme-Spec 2026-06-28).
  const themeColor = env.VITE_BRAND_THEME_COLOR || '#10b981'

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
          // Splash-Hintergrund = „vital"-Light-Background (#F6F7F9, Theme-Spec).
          background_color: '#f6f7f9',
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
          runtimeCaching: [
            {
              // Open-Food-Facts-Produktabfragen: frisch bevorzugt, offline
              // fällt der Barcode-Lookup auf zuletzt gesehene Produkte zurück.
              urlPattern: /^https:\/\/world\.openfoodfacts\.org\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'off-products',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Vendor-Split: hält jeden Chunk unter ~350 kB (Abschlussplan Paket 5)
          // und verbessert Cache-Trefferquote bei App-Updates.
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-motion': ['framer-motion'],
            'vendor-db': ['dexie', 'dexie-react-hooks'],
            'vendor-i18n': ['i18next', 'react-i18next'],
            'vendor-zod': ['zod'],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  }
})
