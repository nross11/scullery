import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8787' } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Scullery',
        short_name: 'Scullery',
        description: 'Our recipes, cook notes, meal plans and shopping lists.',
        theme_color: '#4d6b46',
        background_color: '#f7f1e6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // Recently viewed recipes stay readable with a weak kitchen signal.
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/recipes'), handler: 'NetworkFirst', options: { cacheName: 'api-recipes', networkTimeoutSeconds: 4, expiration: { maxEntries: 200 } } },
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/photos'), handler: 'CacheFirst', options: { cacheName: 'photos', expiration: { maxEntries: 300 } } },
        ],
      },
    }),
  ],
  test: { root: '.', include: ['tests/**/*.test.ts'] },
} as any);
