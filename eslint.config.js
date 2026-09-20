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
// A pure file may sit at the feature root (model.ts), one level down (masks/)
// or two (editing/algorithms/), and the relative spelling of an upper module
// differs at each depth. Collect the directories pure files live in so the
// deny-list can carry the spelling each of them would actually write.
const pureDirs = (feature) =>
  new Set(
    feature.pure.files.flatMap((file) => {
      const dir = path.posix.dirname(file.slice(`src/${feature.dir}/`.length));
      if (!dir.includes('*')) return [dir === '.' ? '' : dir];
      const base = dir.replace(/\/?\*+.*$/, '');
      return [base, `${base}/*`];
    })
  );
const relativeSpellings = (feature, mod) =>
  [...pureDirs(feature)].map((dir) => {
    const spelling = path.posix.relative(dir, mod);
    return spelling.startsWith('.') ? spelling : `./${spelling}`;
  });

// A bare directory resolves to the index file inside it, so a feature whose
// index is an upper module also has to deny '.', '..' and `@/src/<dir>` — they
// reach the same module as './index', '../index' and `@/src/<dir>/index`.
// These are exact paths, not patterns: the pattern '..' would also deny every
// '../sibling' the pure layer imports from itself.
const entryPointSpellings = (feature) =>
  feature.pure.upperModules.includes('index')
    ? [
        `@/src/${feature.dir}`,
        ...new Set(
          [...pureDirs(feature)].map(
            (dir) => path.posix.relative(dir, '') || '.'
          )
        ),
      ]
    : [];

const upperLayerMessage = (feature) =>
  `The ${feature.dir} pure layer must not import stores, components, or upper feature modules — dependencies point downward only.`;

// `pure.upperModules` is a hand-maintained list of the feature's non-pure
// modules: a new one has to be added here or the pure layer may import it.
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
      files: feature.pure.files,
      ignores: ['**/__tests__/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              ...['pinia', 'vue'].map((name) => ({
                name,
                message: `The ${feature.dir} pure layer must stay framework-free — no ${name}.`,
              })),
              ...entryPointSpellings(feature).map((name) => ({
                name,
                message: upperLayerMessage(feature),
              })),
            ],
            patterns: [
              {
                group: [
                  ...new Set(
                    feature.pure.upperModules.flatMap((mod) => [
                      `@/src/${feature.dir}/${mod}`,
                      ...relativeSpellings(feature, mod),
                    ])
                  ),
                  '@/src/store/**',
                  '@/src/components/**',
                  '@/src/composables/**',
                ],
                message: upperLayerMessage(feature),
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
      pure: {
        files: [
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
        upperModules: [
          'store',
          'segments',
          'segmentRegistry',
          'segmentReferences',
          'masks/voxelAccess',
          'io/**',
          'rendering/**',
          'editing/coordinator',
          'editing/paintProcess',
          'editing/processWorker',
          'editing/fillHoles',
          'editing/fillBetween',
          'editing/gaussianSmooth',
          'editing/rasterizePolygon',
          'components/**',
          'composables/**',
        ],
      },
      // Consumers import explicit modules; the pure-layer rule still applies.
      publicSurface: false,
    },
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
          'annotationKinds',
          'index',
          'components/**',
          'composables/**',
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
        upperModules: [
          'store',
          'index',
          'useReferenceLines',
          'ReferenceLines.vue',
          'components/**',
        ],
      },
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
