import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/cache/**'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
];
