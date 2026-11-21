import { defineConfig } from 'vite';
import { readBuildMetadata } from './scripts/build-metadata.js';

export default defineConfig({
  define: {
    __BUILD_METADATA__: JSON.stringify(readBuildMetadata())
  }
});
