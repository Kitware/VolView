import { resolve as resolvePath } from 'path';
import { defineConfig, normalizePath } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify';
import { createHtmlPlugin } from 'vite-plugin-html';
import { viteStaticCopy } from 'vite-plugin-static-copy';

function resolve(...args) {
  return normalizePath(resolvePath(...args));
}

const rootDir = resolve(__dirname);
const nodeModulesDir = resolve(rootDir, 'node_modules');
const distDir = resolve(rootDir, 'dist');

export default defineConfig({
  build: {
    outDir: distDir,
  },
  resolve: {
    alias: [
      {
        find: '@',
        replacement: rootDir,
      },
      {
        find: '@src',
        replacement: resolve(rootDir, 'src'),
      },
    ],
  },
  plugins: [
    vue({ template: { transformAssetUrls } }),
    vuetify({
      autoImport: true,
    }),
    createHtmlPlugin({
      minify: true,
      template: 'public/index.html',
      inject: {
        data: {
          gaId: process.env.VOLVIEW_GA_ID || null,
        },
      },
    }),
    viteStaticCopy({
      targets: [
        {
          src: resolve(
            nodeModulesDir,
            'itk-wasm/dist/web-workers/bundles/pipeline.worker.js'
          ),
          dest: 'itk',
        },
        {
          src: resolve(nodeModulesDir, 'itk-image-io'),
          dest: 'itk/image-io',
        },
        {
          src: 'src/io/itk-dicom/emscripten-build/**/dicom*',
          dest: 'itk/pipelines',
        },
        {
          src: 'src/io/resample/emscripten-build/**/resample*',
          dest: 'itk/pipelines',
        },
      ],
    }),
  ],
});
