import { defineConfig } from 'vite';
import { sharedConfig } from './vite.config.mjs';
import { r, isDev } from './scripts/utils';

// MV3 service worker: a single self-contained ES module, without Vue or DOM dependencies.
export default defineConfig({
  resolve: sharedConfig.resolve,
  define: {
    ...sharedConfig.define,
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  build: {
    outDir: r('extension/dist'),
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    minify: false,
    lib: {
      entry: r('src/background/main.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
  },
});
