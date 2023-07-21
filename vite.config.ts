/// <reference types="vitest" />
import { resolve as resolvePath } from 'path';
import { Plugin, defineConfig, normalizePath } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify';
import { createHtmlPlugin } from 'vite-plugin-html';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { visualizer } from 'rollup-plugin-visualizer';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import replace from '@rollup/plugin-replace';

import pkgLock from './package-lock.json';
import { shouldAutoChunk } from './src/lazy';

function resolve(...args) {
  return normalizePath(resolvePath(...args));
}

const rootDir = resolve(__dirname);
const nodeModulesDir = resolve(rootDir, 'node_modules');
const distDir = resolve(rootDir, 'dist');

const { ANALYZE_BUNDLE, SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } =
  process.env;

function configureSentryPlugin() {
  return SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT
    ? sentryVitePlugin({
        telemetry: false,
        org: SENTRY_ORG,
        project: SENTRY_PROJECT,
        authToken: SENTRY_AUTH_TOKEN,
      })
    : ({} as Plugin);
}

export default defineConfig({
  build: {
    outDir: distDir,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('vuetify')) {
            return 'vuetify';
          }
          if (id.includes('vtk.js')) {
            if (id.includes('OpenGL')) {
              return 'vtk.js-opengl';
            }
            return 'vtk.js';
          }
          if (id.includes('node_modules')) {
            if (shouldAutoChunk(id)) {
              return undefined;
            }
            if (id.includes('whatwg-url')) {
              return 'whatwg-url';
            }
            return 'vendor';
          }
          return undefined;
        },
      },
    },
    sourcemap: true,
  },
  define: {
    __VERSIONS__: {
      volview: pkgLock.version,
      'vtk.js': pkgLock.dependencies['@kitware/vtk.js'].version,
      'itk-wasm': pkgLock.dependencies['itk-wasm'].version,
    },
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
    {
      name: 'virtual-modules',
      load(id) {
        if (id.includes('@kitware/vtk.js')) {
          if (id.includes('ColorMaps.json.js')) {
            // We don't use the built-in colormaps
            return 'export const v = []';
          }

          // We don't use these classes
          if (id.includes('CubeAxesActor') || id.includes('ScalarBarActor')) {
            return 'export default {}';
          }

          // TODO: vtk.js WebGPU isn't ready as of mid-2023
          if (id.includes('WebGPU')) {
            return 'export default {}';
          }
        }

        return null;
      },
    },
    replace({
      preventAssignment: true,
      // better sentry treeshaking
      __SENTRY_DEBUG__: false,
      __SENTRY_TRACING__: false,
    }),
    vue({ template: { transformAssetUrls } }),
    vuetify({
      autoImport: true,
    }),
    createHtmlPlugin({
      minify: true,
      template: 'index.html',
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
    ANALYZE_BUNDLE
      ? visualizer({
          template: 'treemap',
          open: true,
          gzipSize: true,
          brotliSize: true,
          filename: 'bundle-analysis.html',
        })
      : ({} as Plugin),
    configureSentryPlugin(),
  ],
  server: {
    port: 8080,
  },
  test: {
    environment: 'jsdom',
    // canvas support. See: https://github.com/vitest-dev/vitest/issues/740
    threads: false,
    deps: {
      // needed for unit tests on components utilizing vuetify
      inline: ['vuetify'],
    },
  },
});
