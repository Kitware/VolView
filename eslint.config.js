import js from '@eslint/js';
import eslintPluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'src/io/itk-dicom/emscripten-build/**',
      'src/io/resample/emscripten-build/**',
      '**/*.d.ts',
      'dist/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginVue.configs['flat/essential'],
  {
    files: ['**/*.{js,ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        globalThis: 'readonly',
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
      'no-plusplus': 'off',
      'no-underscore-dangle': 'off',
      'lines-between-class-members': [
        'error',
        'always',
        { exceptAfterSingleLine: true },
      ],
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'error',
      'vue/multi-word-component-names': ['error', { ignores: ['Settings'] }],
      'prefer-destructuring': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  {
    files: ['**/tests/pageobjects/**/*.ts'],
    rules: {
      'class-methods-use-this': 'off',
    },
  },
  {
    files: ['**/__tests__/*.{js,ts}', '**/tests/unit/**/*.spec.{js,ts}'],
    languageOptions: {
      globals: globals.mocha,
    },
    rules: {
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['src/vtk/**/*.{js,ts}'],
    rules: {
      'no-param-reassign': [
        'error',
        {
          props: true,
          ignorePropertyModificationsFor: [
            'publicAPI',
            'model',
            'state',
            'outData',
          ],
        },
      ],
    },
  },
  // ---------------------------------------------------------------------------
  // Processing feature layering boundaries.
  //
  // Enforced with the built-in `no-restricted-imports` — eslint-plugin-import is
  // not a dependency of this repo, and the built-in rule expresses the same
  // zones with no new dependency. Two rules:
  //   1. Code OUTSIDE `src/processing/` may reach the feature ONLY through its
  //      public surface `@/src/processing` (the index), never a deep path.
  //   2. The feature's pure layer (`engine/**`, `types.ts`, `config.ts`) may not
  //      import stores, components, or the upper feature modules, and stays
  //      framework-free (no pinia, no vue) — dependencies point downward only.
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.{js,ts,vue}'],
    ignores: ['src/processing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/src/processing/*',
                '@/src/processing/*/**',
                '!@/src/processing/index',
              ],
              message:
                'Import the processing feature only from its public surface `@/src/processing` (src/processing/index.ts). A deep import bypasses the feature boundary.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/processing/engine/**/*.{js,ts}',
      'src/processing/types.ts',
      'src/processing/config.ts',
    ],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pinia',
              message:
                'The processing pure layer (engine/types/config) must stay framework-free — no pinia.',
            },
            {
              name: 'vue',
              message:
                'The processing pure layer (engine/types/config) must stay framework-free — no vue.',
            },
          ],
          patterns: [
            {
              group: [
                '@/src/processing/store',
                '@/src/processing/applyResults',
                '@/src/processing/jobResultReview',
                '@/src/processing/index',
                '@/src/processing/components/**',
                '@/src/store/**',
                '@/src/components/**',
                './store',
                './applyResults',
                './jobResultReview',
                './index',
                '../store',
                '../applyResults',
                '../jobResultReview',
                '../index',
                '../components/**',
              ],
              message:
                'The processing pure layer (engine/types/config) must not import stores, components, or upper feature modules — dependencies point downward only.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier
);
