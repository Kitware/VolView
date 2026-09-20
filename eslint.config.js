import path from 'node:path';
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
// `pure` lists the feature's pure files, and that one list is also everything
// a pure file may import from its own feature: a module that is not on it is
// denied without having to be named. A directory glob admits the directory.
const pureModules = (feature) =>
  feature.pure.map((file) =>
    file
      .slice(`src/${feature.dir}/`.length)
      .replace(/\/\*\*\/.*$/, '/**')
      .replace(/\.\w+$/, '')
  );

// Patterns follow gitignore, which cannot re-admit a path under a denied
// directory. So each directory on the way to a pure module denies its children
// and re-admits the ones that are pure or lead to one.
const ownFeatureExceptPure = (feature) => {
  const root = `@/src/${feature.dir}`;
  const admitted = new Set(
    pureModules(feature).flatMap((module) => {
      const parts = module.replace(/\/\*\*$/, '').split('/');
      return parts.map((_, depth) => parts.slice(0, depth + 1).join('/'));
    })
  );
  const wholeDirs = pureModules(feature)
    .filter((module) => module.endsWith('/**'))
    .map((module) => module.slice(0, -3));
  const parentOf = (entry) => path.posix.dirname(entry).replace(/^\.$/, '');
  const denyingDirs = new Set(
    [...admitted].map(parentOf).filter((dir) => !wholeDirs.includes(dir))
  );
  return [...denyingDirs]
    .sort()
    .flatMap((dir) => [
      `${root}/${dir ? `${dir}/` : ''}*`,
      ...[...admitted]
        .filter((entry) => parentOf(entry) === dir)
        .map((entry) => `!${root}/${entry}`),
    ]);
};

const upperLayerMessage = (feature) =>
  `The ${feature.dir} pure layer must not import stores, components, or upper feature modules. Dependencies point downward only.`;

const featureBoundaries = (features) => {
  const publicSurface = ({ dir }) => ({
    group: [`@/src/${dir}/*`, `@/src/${dir}/*/**`, `!@/src/${dir}/index`],
    message: `Import the ${dir} feature only from its public surface \`@/src/${dir}\` (src/${dir}/index.ts). A deep import bypasses the feature boundary.`,
  });
  const publicFeatures = features.filter(
    (feature) => feature.publicSurface !== false
  );
  const otherSurfaces = (feature) =>
    publicFeatures.filter((other) => other !== feature).map(publicSurface);

  return [
    {
      files: ['src/**/*.{js,ts,vue}'],
      ignores: features.map(({ dir }) => `src/${dir}/**`),
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: publicFeatures.map(publicSurface) },
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
      files: feature.pure,
      ignores: ['**/__tests__/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              ...['pinia', 'vue'].map((name) => ({
                name,
                message: `The ${feature.dir} pure layer must stay framework-free: no ${name}.`,
              })),
              // The bare directory is the index, an upper module.
              {
                name: `@/src/${feature.dir}`,
                message: upperLayerMessage(feature),
              },
            ],
            patterns: [
              {
                group: [
                  ...ownFeatureExceptPure(feature),
                  '@/src/store/**',
                  '@/src/components/**',
                  '@/src/composables/**',
                ],
                message: upperLayerMessage(feature),
              },
              {
                // The list above can only judge the alias spelling.
                regex: '^\\.\\.?(/|$)',
                message: `The ${feature.dir} pure layer spells its imports from \`@/src/\`, so the pure-layer boundary can see them.`,
              },
              ...otherSurfaces(feature),
            ],
          },
        ],
      },
    })),
  ];
};

// Files that still pass their own time limits. Remove a file once it is
// clean; never add one.
const E2E_TIMEOUT_DEBT = [
  'tests/pageobjects/volview.page.ts',
  'tests/specs/annotationTestUtils.ts',
  'tests/specs/automatic-layering.e2e.ts',
  'tests/specs/bug-report.e2e.ts',
  'tests/specs/cine-drag-onto-slot.e2e.ts',
  'tests/specs/cine-rendering.e2e.ts',
  'tests/specs/cine-ruler-session.e2e.ts',
  'tests/specs/crosshairs-multi-image.e2e.ts',
  'tests/specs/delete-selected-annotation.e2e.ts',
  'tests/specs/dicom-dimension-mismatch.e2e.ts',
  'tests/specs/different-direction-labelmap.e2e.ts',
  'tests/specs/imageCacheUtils.ts',
  'tests/specs/layer-source-lifetime.e2e.ts',
  'tests/specs/layers-and-rendering.e2e.ts',
  'tests/specs/multi-series-load.e2e.ts',
  'tests/specs/paint-tool-rendering.e2e.ts',
  'tests/specs/polygon-nested-interaction.e2e.ts',
  'tests/specs/sample-rendering.e2e.ts',
  'tests/specs/save-large-labelmap.e2e.ts',
  'tests/specs/seg-nrrd-export.e2e.ts',
  'tests/specs/select-annotation-at-press.e2e.ts',
  'tests/specs/select-tool-annotation-press.e2e.ts',
  'tests/specs/session-large-uri-base.e2e.ts',
  'tests/specs/sparse-manifest-prostate-rectangle.e2e.ts',
  'tests/specs/sparse-manifest.e2e.ts',
  'tests/specs/ultrasound-spacing.e2e.ts',
  'tests/specs/vtk-interactor-lifecycle.e2e.ts',
];

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
  // Node tooling (scripts/checks/, fixture servers). The block above matches
  // only .js/.ts/.vue, so without this eslint reports `process`, `console` and
  // `URL` as undefined in every .mjs file.
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['**/tests/pageobjects/**/*.ts'],
    rules: {
      'class-methods-use-this': 'off',
    },
  },
  // A wait with its own time limit stands in for a state the app should
  // publish, and fails on a slow machine. Wait on the state instead.
  {
    files: ['**/tests/specs/**/*.ts', '**/tests/pageobjects/**/*.ts'],
    ignores: E2E_TIMEOUT_DEBT,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='timeout']",
          message:
            'Wait for a state the page publishes rather than passing a timeout.',
        },
        {
          selector:
            "CallExpression[callee.object.name='browser'][callee.property.name='pause']",
          message: 'Wait for a state the page publishes rather than pausing.',
        },
      ],
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
  // -------------------------------------------------------------------------
  // Unit tests wire collaborators in, they do not replace modules.
  //
  // Expressed with the built-in `no-restricted-syntax` for the same reason the
  // feature boundaries use `no-restricted-imports`: no new plugin dependency.
  // `vi.hoisted` is deliberately not listed: it exists to hoist values used by
  // `vi.mock`, so flagging it as well would only double the report on a site
  // the `vi.mock` selector already catches.
  // -------------------------------------------------------------------------
  {
    files: ['**/__tests__/**/*.{js,ts}', '**/tests/unit/**/*.spec.{js,ts}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/]",
          message:
            'Do not replace a module with vi.mock. Give the unit under test a parameter for the collaborator with the real one as its default (`useThing(dep = realDep)`), then hand a real object in from the spec. vi.fn and vi.spyOn on a real object are still fine.',
        },
      ],
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
      dir: 'segmentation',
      pure: [
        'src/segmentation/geometry.ts',
        'src/segmentation/color.ts',
        'src/segmentation/model.ts',
        'src/segmentation/segment.ts',
        'src/segmentation/masks/storage.ts',
        'src/segmentation/masks/overlap.ts',
        'src/segmentation/masks/labelValue.ts',
        'src/segmentation/editing/algorithms/fillHoles.ts',
        'src/segmentation/editing/algorithms/fillHoles.worker.ts',
        'src/segmentation/editing/algorithms/gaussianSmooth.worker.ts',
      ],
      // Consumers import explicit modules; the pure-layer rule still applies.
      publicSurface: false,
    },
    {
      dir: 'processing',
      pure: [
        'src/processing/engine/**/*.{js,ts}',
        'src/processing/types.ts',
        'src/processing/config.ts',
      ],
    },
    {
      dir: 'referenceLines',
      pure: [
        'src/referenceLines/geometry.ts',
        'src/referenceLines/crossings.ts',
      ],
    },
  ]),
  // Tests are excluded so this block never matches a file the `vi.mock` block
  // above matches: flat config replaces a rule's options wholesale, so overlap
  // would erase that rule rather than add to it.
  {
    files: ['src/**/*.{ts,vue}'],
    ignores: ['src/**/__tests__/**', 'src/**/*.{spec,test}.{js,ts}'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "CallExpression[callee.name='computed'][typeArguments.params.length>0]",
          message:
            'Let computed() infer its type. An explicit generic goes stale and hides the inference errors it was meant to document.',
        },
      ],
    },
  },
  // Mirrors the limits scripts/checks/complexity.mjs enforces per commit. Warn
  // level because the ratchet only fails a file whose debt grows, so existing
  // files stay over these numbers without failing `npm run lint`.
  {
    files: ['src/**/*.{js,ts,vue}'],
    ignores: [
      'src/**/__tests__/**',
      'src/**/*.{spec,test}.{js,ts}',
      'src/**/*.d.ts',
      '**/emscripten-build/**',
    ],
    rules: {
      complexity: ['warn', 10],
      'max-depth': ['warn', 3],
      'max-params': ['warn', 4],
      'max-lines': [
        'warn',
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  eslintConfigPrettier
);
