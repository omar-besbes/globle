import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Builds the whole game into one self-contained HTML file, for offline play or
 * for hosting somewhere that only takes a single page. The data pack cannot be
 * fetched in that setting, so it is inlined into the document and picked up by
 * loadData().
 */
function inlineDataPack(): Plugin {
  return {
    name: 'inline-data-pack',
    transformIndexHtml() {
      const read = (f: string) => readFileSync(new URL(`./public/data/${f}`, import.meta.url));
      const payload = {
        countries: JSON.parse(read('countries.json').toString()),
        geometry: JSON.parse(read('geometry.json').toString()),
        distBase64: read('dist.bin').toString('base64'),
      };
      return [{
        tag: 'script',
        injectTo: 'head-prepend' as const,
        children: `window.__GLOBLE_DATA__=${JSON.stringify(payload)};`,
      }];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), inlineDataPack(), viteSingleFile()],
  build: { outDir: 'dist-standalone', chunkSizeWarningLimit: 4000 },
});
