import { defineConfig } from 'vite';

export default defineConfig({
  // Suhteelliset polut: sovellus toimii missä tahansa alihakemistossa (esim. GitHub Pages)
  base: './',
  // MapLibre 6 lataa worker-tiedostonsa itse; esipaketointi rikkoisi polun kehityspalvelimessa
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
