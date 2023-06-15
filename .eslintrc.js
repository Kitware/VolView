module.exports = {
  root: true,

  env: {
    node: true,
  },

  settings: {
    'import/resolver': {
      typescript: {},
    },
  },

  parserOptions: {
    parser: '@typescript-eslint/parser',
  },

  plugins: ['@typescript-eslint', 'import'],

  ignorePatterns: [
    'src/io/itk-dicom/emscripten-build/**',
    'src/io/resample/emscripten-build/**',
    '**/*.d.ts',
  ],

  globals: {
    globalThis: false, // not writeable
  },

  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'import/no-named-as-default-member': 'off',
    'import/no-named-as-default': 'off',
    'import/prefer-default-export': 'off',
    'no-plusplus': 'off',
    'no-underscore-dangle': 'off',
    'import/extensions': [
      'error',
      'ignorePackages',
      {
        js: 'never',
        jsx: 'never',
        ts: 'never',
        tsx: 'never',
      },
    ],
    'lines-between-class-members': [
      'error',
      'always',
      {
        exceptAfterSingleLine: true,
      },
    ],
    // use typescript no-shadow
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',
    // use typescript no-unused
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'error',
    // don't trigger no-unused-expressions for optional chaining
    'no-unused-expressions': 'off',
    '@typescript-eslint/no-unused-expressions': 'error',
    'vue/multi-word-component-names': [
      'error',
      {
        ignores: ['Settings'],
      },
    ],
  },

  overrides: [
    {
      files: ['vite.config.js'],
      rules: {
        'import/no-extraneous-dependencies': 'off',
      },
    },
    {
      files: [
        '**/__tests__/*.{j,t}s?(x)',
        '**/tests/unit/**/*.spec.{j,t}s?(x)',
      ],
      env: {
        mocha: true,
      },
      rules: {
        // for expect()
        'no-unused-expressions': 'off',
        '@typescript-eslint/no-unused-expressions': 'off',
      },
    },
    {
      files: ['src/vtk/**/*.{j,t}s'],
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
  ],

  extends: [
    'plugin:vue/vue3-essential',
    '@vue/airbnb',
    'prettier',
    'prettier/vue',
    '@vue/typescript',
  ],
};
