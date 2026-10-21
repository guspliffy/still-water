import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/, so the build uses a relative base.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
