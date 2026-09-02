import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";

export default [
  // ✅ Base JS rules
  js.configs.recommended,

  // ✅ MAIN BACKEND RULES
  {
    files: ["**/*.js"],

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
        setInterval: "readonly",
        clearInterval: "readonly"
      }
    },

    plugins: {
      import: importPlugin
    },

    rules: {
      // ✅ Existing rules
      "no-unused-vars": ["warn"],
      "no-console": "off",

      // ✅ Import rules (NEW)
      "import/no-unresolved": "error",
      "import/named": "error"
    }
  },

  // ✅ TEST FILES (Jest)
  {
    files: ["**/*.test.js", "**/*.spec.js", "**/tests/**/*.js"],

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
        afterEach: "readonly"
      }
    }
  },

  // ✅ IGNORE FOLDERS
  {
    ignores: ["node_modules", "logs", "dist"]
  }
];