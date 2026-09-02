/**
 * ESLint Configuration for Frontend (React + Vite)
 * Enforces code quality and React best practices
 */

module.exports = {
  env: {
    browser: true,
    es2021: true,
  },

  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],

  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },

  settings: {
    react: {
      version: 'detect',
    },
  },

  globals: {
    console: 'readonly', // ✅ Fix console undefined errors
  },

  rules: {
    // -------------------------
    // Possible Errors
    // -------------------------
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // -------------------------
    // Best Practices
    // -------------------------
    curly: ['error', 'all'],
    eqeqeq: ['error', 'always'],
    'no-eval': 'error',
    'no-implicit-coercion': 'error',
    'no-param-reassign': 'warn',
    'no-shadow': ['warn', { builtinGlobals: false }],

    // -------------------------
    // Stylistic Rules
    // -------------------------
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

    // -------------------------
    // React Rules
    // -------------------------
    'react/react-in-jsx-scope': 'off', // React 17+
    'react/jsx-uses-react': 'off',
    'react/prop-types': 'warn',
    'react/no-unescaped-entities': 'warn',
    'react/display-name': 'warn',
    'react/jsx-key': 'error',
    'react/jsx-no-duplicate-props': 'error',

    // -------------------------
    // React Hooks
    // -------------------------
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // -------------------------
    // Variables
    // -------------------------
    'no-undef': 'error',
    'no-use-before-define': ['error', { functions: false }],

    // -------------------------
    // ES6 Rules
    // -------------------------
    'arrow-spacing': ['error', { before: true, after: true }],
    'no-const-assign': 'error',
    'no-var': 'error',
    'prefer-const': ['warn', { destructuring: 'any' }],
    'prefer-arrow-callback': 'warn',
  },
};