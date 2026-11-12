import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "bin/csr"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "max-len": ["error", { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    // The evidence tools evaluate functions inside a browser page.
    files: ["tools/capture_screenshots.js", "tools/render_architecture.js", "tools/record_demo.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    ignores: ["node_modules/**", "coverage/**", "docs/evidence/**", "fixture/force-app/**"],
  },
];
