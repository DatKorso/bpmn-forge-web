import { defineConfig } from 'vite';
import { readBuildMetadata } from './scripts/build-metadata.js';

export default defineConfig({
  build: {
    license: { fileName: 'third-party-licenses.md' }
  },
  define: {
    __BUILD_METADATA__: JSON.stringify(readBuildMetadata())
  }
});
