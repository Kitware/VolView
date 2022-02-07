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

  ignorePatterns: ['src/io/itk-dicom/web-build/**', '**/*.d.ts'],

  globals: {
    globalThis: false, // not writeable
  },

  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'import/no-named-as-default-member': 'off',
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
    // use typescript no-shadow
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',
  },

  overrides: [
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
    'plugin:vue/essential',
    '@vue/airbnb',
    'prettier',
    'prettier/vue',
    '@vue/typescript',
  ],
};
