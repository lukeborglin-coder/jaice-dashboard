import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Serve static assets from the existing 'assets' directory
  publicDir: 'assets',
  resolve: {
    alias: {
      // Ensure the browser build of exceljs is used in Vite
      exceljs: 'exceljs/dist/exceljs.min.js',
    },
  },
  optimizeDeps: {
    include: ['exceljs'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
    },
  },
})
