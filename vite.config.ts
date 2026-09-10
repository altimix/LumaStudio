import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({ plugins: [react(), { name: 'development-csp', transformIndexHtml: html => command === 'serve' ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';") : html }], base: './', server: { port: 5173, strictPort: true }, build: { outDir: 'dist' } }));
