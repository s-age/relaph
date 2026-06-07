import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // iife adds dist/index.global.js exposing a `Relaph` global, usable via a
  // classic <script> tag (works from file:// without a server, and via CDN).
  format: ['esm', 'cjs', 'iife'],
  globalName: 'Relaph',
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2020',
});
