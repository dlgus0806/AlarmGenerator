import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  // 로컬 탐색 백엔드로 프록시 (npm run server 로 실행)
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
