import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';

export default defineConfig({
  plugins: [
    commonjs({
      transformMixedEsModules: true,
      include: '**/*',
    }),
    copy({
      targets: [{ src: './src/type.d.ts', dest: 'dist' }],
    }),
  ],

  build: {
    lib: {
      name: 'lamejs',
      formats: ['es', 'iife'],
      entry: fileURLToPath(new URL('./src/js/index.js', import.meta.url)),
    },
    rollupOptions: {
      output: {
        exports: 'named',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
