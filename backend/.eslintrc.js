/**
 * ESLint Configuration for Backend (Node.js)
 * Enforces code quality and consistency across backend services
 */

module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module', // ✅ CRITICAL FIX
    ecmaFeatures: {
      jsx: true,
    },
  },
  rules: {
    // Possible Errors
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // Best Practices
    curly: ['error', 'all'],
    eqeqeq: ['error', 'always'],
    'no-eval': 'error',
    'no-implicit-coercion': 'error',
    'no-param-reassign': 'warn',
    'no-shadow': ['warn', { builtinGlobals: false }],

    // Stylistic Issues
    'array-bracket-spacing': ['error', 'never'],
    'block-spacing': ['error', 'always'],
    'brace-style': ['error', '1tbs', { allowSingleLine: true }],
    camelcase: ['warn', { properties: 'never' }],
    'comma-spacing': ['error', { before: false, after: true }],
    'comma-style': ['error', 'last'],
    'computed-property-spacing': ['error', 'never'],
    'func-call-spacing': ['error', 'never'],
    indent: ['error', 2, { SwitchCase: 1 }],
    'key-spacing': ['error', { beforeColon: false, afterColon: true }],
    'keyword-spacing': ['error', { before: true, after: true }],
    'linebreak-style': ['error', 'unix'],
    'max-len': ['warn', { code: 100, ignoreUrls: true, ignoreStrings: true }],
    'no-multi-spaces': 'error',
    'no-multiple-empty-lines': ['error', { max: 2 }],
    'object-curly-spacing': ['error', 'always'],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
    'space-before-blocks': ['error', 'always'],
    'space-before-function-paren': [
      'error',
      {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always',
      },
    ],
    'space-in-parens': ['error', 'never'],
    'space-infix-ops': 'error',
    'space-unary-ops': ['error', { words: true, nonwords: false }],

    // Variables
    'no-undef': 'error',
    'no-use-before-define': ['error', { functions: false }],

    // ES6
    'arrow-spacing': ['error', { before: true, after: true }],
    'no-const-assign': 'error',
    'no-var': 'error',
    'prefer-const': ['warn', { destructuring: 'any' }],
    'prefer-arrow-callback': 'warn',
  },
};
