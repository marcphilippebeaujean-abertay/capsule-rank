import globals from 'globals';

export default [
  {
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Alpine: 'readonly',
      },
    },
    rules: {
      // app.js intentionally exposes pure helpers in the global scope so
      // tests.html can call them without a module loader. Don't flag them.
      'no-unused-vars': 'off',
      'no-undef': 'error',
      'eqeqeq': ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'debug.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // node for the script body; browser for callbacks passed to page.evaluate().
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-undef': 'error',
      'eqeqeq': ['error', 'smart'],
      'no-var': 'error',
    },
  },
];
