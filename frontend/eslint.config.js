import js from "@eslint/js";
import react from "eslint-plugin-react";

export default [
  js.configs.recommended,

  {
    files: ["**/*.{js,jsx,ts,tsx}"],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly"
      }
    },

    plugins: {
      react
    },

    settings: {
      react: {
        version: "detect"
      }
    },

    rules: {
      ...react.configs.recommended.rules,

      "react/react-in-jsx-scope": "off"
    }
  },

  {
    ignores: ["node_modules", "dist", "build"]
  }
];