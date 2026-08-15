import js from '@eslint/js';
import eslintPluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

// ---------------------------------------------------------------------------
// Feature layering boundaries.
//
// Enforced with the built-in `no-restricted-imports` — eslint-plugin-import is
// not a dependency of this repo, and the built-in rule expresses the same
// zones with no new dependency. Two zones per feature:
//   1. Code OUTSIDE the feature directory may reach it ONLY through its public
//      surface `@/src/<dir>` (the index), never a deep path.
//   2. The feature's pure layer may not import stores, components, or the
//      upper feature modules, and stays framework-free (no pinia, no vue) —
//      dependencies point downward only.
//
// Flat config replaces a rule's options wholesale when a later block matches
// the same file, so all features are generated together: each block carries
// the full pattern set its files need, and no block silently erases another
// feature's boundary.
// ---------------------------------------------------------------------------
// `pure.upperModules` is a hand-maintained list of the feature's non-pure
// modules: a new one has to be added here or the pure layer may import it.
const featureBoundaries = (features) => {
  const publicSurface = ({ dir }) => ({
    group: [`@/src/${dir}/*`, `@/src/${dir}/*/**`, `!@/src/${dir}/index`],
    message: `Import the ${dir} feature only from its public surface \`@/src/${dir}\` (src/${dir}/index.ts). A deep import bypasses the feature boundary.`,
  });
  const otherSurfaces = (feature) =>
    features.filter((other) => other !== feature).map(publicSurface);

  return [
    {
      files: ['src/**/*.{js,ts,vue}'],
      ignores: features.map(({ dir }) => `src/${dir}/**`),
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: features.map(publicSurface) },
        ],
      },
    },
    ...features.map((feature) => ({
      files: [`src/${feature.dir}/**/*.{js,ts,vue}`],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: otherSurfaces(feature) },
        ],
      },
    })),
    ...features.map((feature) => ({
      files: feature.pure.files,
      ignores: ['**/__tests__/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['pinia', 'vue'].map((name) => ({
              name,
              message: `The ${feature.dir} pure layer must stay framework-free — no ${name}.`,
            })),
            patterns: [
              {
                group: [
                  ...feature.pure.upperModules.flatMap((mod) => [
                    `@/src/${feature.dir}/${mod}`,
                    `./${mod}`,
                    `../${mod}`,
                  ]),
                  '@/src/store/**',
                  '@/src/components/**',
                ],
                message: `The ${feature.dir} pure layer must not import stores, components, or upper feature modules — dependencies point downward only.`,
              },
              ...otherSurfaces(feature),
            ],
          },
        ],
      },
    })),
  ];
};

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
  ...featureBoundaries([
    {
      dir: 'processing',
      pure: {
        files: [
          'src/processing/engine/**/*.{js,ts}',
          'src/processing/types.ts',
          'src/processing/config.ts',
        ],
        upperModules: [
          'store',
          'applyResults',
          'jobResultReview',
          'index',
          'components/**',
        ],
      },
    },
    {
      dir: 'referenceLines',
      pure: {
        files: [
          'src/referenceLines/geometry.ts',
          'src/referenceLines/crossings.ts',
        ],
        upperModules: ['store', 'index', 'useReferenceLines', 'components/**'],
      },
    },
  ]),
  eslintConfigPrettier
);
