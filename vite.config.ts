import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  publicDir: '../../public',
  server: {
    host: '127.0.0.1',
    port: 5188,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3450', changeOrigin: true },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
