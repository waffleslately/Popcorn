import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point Vite directly at the TS source so it doesn't hit the CJS dist
      '@popcorn/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — cached aggressively
          'vendor-react': ['react', 'react-dom'],
          // Socket.IO client — large, rarely changes
          'vendor-socket': ['socket.io-client'],
          // HLS.js player — heavy media lib
          'vendor-player': ['hls.js'],
          // QR code + fuzzy search — lazy UI deps
          'vendor-ui': ['qrcode', 'fuse.js'],
          // Zustand — state management
          'vendor-store': ['zustand'],
        }
      }
    },
    // hls.js is a full media library (~186 kB gzipped); suppress the warning
    chunkSizeWarningLimit: 600
  }
});
