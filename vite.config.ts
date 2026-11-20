import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/ai-town',
  plugins: [react()],
  // Convex codegen may emit `export const env = process.env` in `_generated/server.js`.
  // The client imports some aiTown modules that transitively load that file; shim process.
  define: {
    'process.env': '{}',
  },
  server: {
    // Bind IPv4 too — default can be ::1 only, so http://127.0.0.1:5173 fails.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['ai-town-your-app-name.fly.dev', 'localhost', '127.0.0.1'],
    proxy: {
      // Direct human-chat service (bypasses Convex for LLM).
      '/chat-api': {
        target: 'http://127.0.0.1:8791',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/chat-api/, ''),
      },
    },
  },
});
