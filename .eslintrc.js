module.exports = {
  root: true,

  env: {
    node: true,
  },

  extends: ['plugin:vue/essential', '@vue/airbnb', 'prettier', 'prettier/vue'],

  parserOptions: {
    parser: 'babel-eslint',
  },

  ignorePatterns: ['src/io/itk-dicom/web-build/**'],

  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'import/no-named-as-default-member': 'off',
    'import/prefer-default-export': 'off',
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
      files: ['src/vtk/**/*.js'],
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
};
