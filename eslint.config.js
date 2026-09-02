import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import react from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";
import security from "eslint-plugin-security";
import prettier from "eslint-plugin-prettier";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,

  // ============================================================
  // ✅ BACKEND (Node.js - CommonJS)
  // ============================================================
  {
    files: ["community-savings-app-backend/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    plugins: {
      import: importPlugin,
      security,
      prettier,
    },
    rules: {
      "no-unused-vars": ["error"],
      "no-console": "off",
      "import/no-unresolved": "error",
      "import/named": "error",
      "security/detect-object-injection": "warn",
      "prettier/prettier": "error",
    },
  },

  // ============================================================
  // ✅ FRONTEND (React + Vite - ES Modules + TS)
  // ============================================================
  {
    files: ["community-savings-app-frontend/src/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsparser,
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
      },
    },
    plugins: {
      react,
      import: importPlugin,
      "jsx-a11y": jsxA11y,
      "@typescript-eslint": tseslint,
      prettier,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "no-unused-vars": "error",
      "import/no-unresolved": "error",
      "import/named": "error",
      "jsx-a11y/alt-text": "warn",
      "@typescript-eslint/no-unused-vars": ["error"],
      "prettier/prettier": "error",
    },
  },

  // ============================================================
  // ✅ TEST FILES (Jest / Vitest)
  // ============================================================
  {
    files: ["**/*.test.{js,ts}", "**/*.spec.{js,ts}", "**/tests/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        jest: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        afterAll: "readonly",
        afterEach: "readonly",
      },
    },
    rules: {
      "no-unused-expressions": "off", // allow chai-style assertions
    },
  },

  // ============================================================
  // ✅ IGNORE FILES
  // ============================================================
  {
    ignores: ["node_modules", "dist", "build", "coverage", "logs"],
  },
];
