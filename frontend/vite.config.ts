import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // In development the backend runs on port 3001.
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
