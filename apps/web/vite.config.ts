import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    // Raise the warning threshold slightly since we now split chunks
    chunkSizeWarningLimit: 300
  }
});
