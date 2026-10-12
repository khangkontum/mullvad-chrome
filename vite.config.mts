/// <reference types="vitest" />
import { dirname, relative } from 'path';
import { defineConfig, UserConfig } from 'vite';
import Vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';
import { r, isDev } from './scripts/utils';

export const sharedConfig: UserConfig = {
  root: r('src'),
  resolve: {
    alias: {
      '@/': `${r('src')}/`,
    },
  },
  define: {
    __DEV__: isDev,
  },
  plugins: [
    Vue(),

    // rewrite assets to use relative path
    {
      name: 'assets-rewrite',
      enforce: 'post',
      apply: 'build',
      transformIndexHtml(html, { path }) {
        return html.replace(/"\/assets\//g, `"${relative(dirname(path), '/assets')}/`);
      },
    },
  ],
  optimizeDeps: {
    include: ['vue', '@vueuse/core', 'webextension-polyfill'],
    exclude: ['vue-demi'],
  },
};

// Extension pages (popup, options). The MV3 service worker is built by vite.config.background.mts
export default defineConfig(() => ({
  ...sharedConfig,
  base: '/dist/',
  build: {
    outDir: r('extension/dist'),
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    // https://developer.chrome.com/docs/webstore/program_policies/#:~:text=Code%20Readability%20Requirements
    rollupOptions: {
      input: {
        options: r('src/options/index.html'),
        popup: r('src/popup/index.html'),
      },
    },
  },
  plugins: [...sharedConfig.plugins!, UnoCSS()],
}));
